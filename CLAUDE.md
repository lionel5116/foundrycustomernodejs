# FoundryCustomerNodeJS

Chat UI for a Microsoft Foundry agent. Plain React (Vite, JS — not Next.js) frontend split from an Express backend that proxies to the Foundry agent via `@azure/ai-projects`.

## Structure

```
backend/    Express API — talks to Foundry via @azure/ai-projects
frontend/   Vite + React (JS) app — FoundryChat.jsx widget
package.json (root)   concurrently scripts to run/kill both together
```

## Running

```
npm run install:all # installs root, backend/, and frontend/ deps in one shot
npm run dev          # from root — starts backend + frontend together
npm run kill          # frees ports 3002 (backend) and 5173 (frontend)
```

Backend alone: `cd backend && cp .env.example .env && npm start` (port 3002).
Frontend alone: `cd frontend && npm run dev` (port 5173).

## How this was built

Started from four reference files in a local `files/` folder (`server.js`, `FoundryChat.jsx`, `package.json`, `.env.example`) and turned them into a proper split-repo app:

1. Copied `files/server.js`, `files/package.json`, `files/.env.example` into `backend/` unchanged.
2. Scaffolded `frontend/` fresh with `npm create vite@latest frontend -- --template react` (plain JS template, no TypeScript).
3. Dropped `FoundryChat.jsx` into `frontend/src/`, replaced the default Vite boilerplate `App.jsx` with a minimal wrapper that renders `<FoundryChat />`, deleted unused boilerplate assets/CSS.
4. Added a root `package.json` with `concurrently` for a single `npm run dev`, and a `kill` script (`lsof -ti :<port> | xargs kill -9`) to free stuck ports.
5. Wrote root `README.md` with setup/run instructions for both halves.

## How frontend and backend talk to each other

`frontend/src/FoundryChat.jsx` never calls Azure/Foundry directly — it only talks to the Express backend at `BACKEND_URL` (`http://localhost:3002`). The backend holds the Foundry credentials and endpoint; the browser never sees them.

Conversation flow:

1. **First message** — no `conversationId` yet, so the widget `POST`s `{ text }` to `/api/agent/start`. The backend creates a new Foundry conversation (`openAIClient.conversations.create`), runs the agent against it (`openAIClient.responses.create`), and returns `{ conversationId, reply }`.
2. **Every message after that** — the widget has a `conversationId` in React state, so it `POST`s `{ conversationId, text }` to `/api/agent/message` instead. The backend appends the message to the existing conversation (`conversations.items.create`) and runs the agent again, returning `{ reply }`.
3. The widget appends `reply` to its message list and re-renders. `conversationId` lives only in the browser tab's React state — refreshing the page starts a brand-new Foundry conversation.

Both routes send the agent selector as `{ body: { agent_reference: { name: agentName, type: "agent_reference" } } }`, where `agentName` comes from `FOUNDRY_AGENT_NAME` in `backend/.env` — this is what tells the shared `PROJECT_ENDPOINT` Foundry project which named agent should answer.

Because this is two separate origins (`5173` vs `3002`), the backend has `app.use(cors())` in `server.js` — without it the browser blocks the requests during preflight (see "Bugs found" below).

## How the backend authenticates to Azure

`server.js` never uses an API key. It authenticates with `DefaultAzureCredential` from `@azure/identity`:

```js
const project = new AIProjectClient(endpoint, new DefaultAzureCredential());
```

`DefaultAzureCredential` is a chain — it tries credential sources in order and uses the first one that succeeds:

1. **`EnvironmentCredential`** — used only if `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` are all *present* in `.env` (this is the service-principal / app-registration path). Their mere presence short-circuits the chain here even if the values are wrong — it doesn't fall through, it fails.
2. **`AzureCliCredential`** — used if step 1 is skipped (those three vars unset) and the user has an active `az login` session. This is the path in use right now: `backend/.env` has the three service-principal vars commented out, so the SDK falls through to the CLI login's cached token.
3. Further fallbacks (managed identity, VS Code credential, etc.) that don't apply in local dev.

Whichever credential succeeds, it's used to fetch an OAuth token scoped to the Foundry project at `PROJECT_ENDPOINT`, which then authorizes every `conversations.*` / `responses.*` call made through `project.getOpenAIClient()`.

`handleAgentError` in `server.js` maps Azure REST failures to actionable HTTP responses for the frontend:

- **401** → auth failed outright (bad/expired credential) — message points at checking the service-principal vars and the IAM role assignment.
- **403** → authenticated, but that identity lacks the Azure AI User / Foundry User role on the project.
- **404** → `FOUNDRY_AGENT_NAME` doesn't match an agent name in the Foundry portal (case-sensitive).

To switch from CLI login to a service principal later, fill in real values for `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` in `backend/.env` and step 1 takes over automatically — no code change needed.

## Bugs found and fixed after initial scaffold

- **Port collision on 3001**: an unrelated Next.js dev server on this machine was already bound to port 3001, which was the backend's original default. Moved the backend to **port 3002** everywhere: `backend/.env`, `backend/.env.example`, and the `BACKEND_URL` constant in `frontend/src/FoundryChat.jsx`. Confirm the port is actually free (`lsof -ti :3002`) before assuming a collision is with your own leftover process rather than someone else's server.
- **CORS ("Failed to fetch")**: `server.js` had no CORS middleware, so the browser blocked the frontend's cross-origin JSON POST during preflight. Added the `cors` package and `app.use(cors())` in `backend/server.js`.
- **Placeholder Azure credentials blocking `az login`**: `backend/.env` shipped with literal placeholder values for `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`. `DefaultAzureCredential` tries `EnvironmentCredential` first whenever those vars are *present*, even if they're garbage — so it failed on the fake tenant ID before ever falling through to `AzureCliCredential` (the one that uses `az login`). Fix: leave those three vars commented out/unset in `.env` when relying on `az login` instead of a service principal.
- **Stale Foundry API request shape**: the live Foundry endpoint rejects the `agent` field the original sample code sent (`"The 'agent' property is deprecated. Use 'agent_reference' instead"`). The installed `@azure/ai-projects` SDK accepts either key client-side, but the deployed API requires `agent_reference`. Fixed in `backend/server.js`'s two routes: `{ body: { agent_reference: { name: agentName, type: "agent_reference" } } }`.

## Deploying both halves to a single Azure App Service

The app can be deployed as one Windows App Service (iisnode) hosting both `backend/` and `frontend/`, instead of running them as two separate services. This requires two code changes beyond what local dev needs, since only one Node process runs in that environment:

- **`backend/server.js`** now serves the built frontend itself: `app.use(express.static(frontendDist))` plus a catch-all `app.get(/^(?!\/api).*/, ...)` that falls back to `frontend/dist/index.html`. This is registered *after* the `/api/agent/*` routes so those still take priority. `frontendDist` resolves to `../frontend/dist` relative to `server.js`, so the deploy package must keep `backend/` and `frontend/dist/` as siblings.
- **`frontend/src/FoundryChat.jsx`**'s `BACKEND_URL` is now `import.meta.env.PROD ? "" : "http://localhost:3002"`. In production the widget is served by the same Express app it calls, so it uses relative `/api/...` fetches (same origin, no CORS needed there). Local dev is unaffected — it still points at port 3002.
- **Root `web.config`** (IIS config, only relevant for this deploy path — not used locally) routes every request through `iisnode` to `backend/server.js`, and hides `node_modules`/`iisnode` log folders from direct HTTP access via `requestFiltering`. Express itself (not IIS) decides whether a request is an API call or a static asset.

**Debugging Windows App Service errors when you can't see the real response**: Kudu's SCM basic auth was disabled on this site, so the usual `https://<app>.scm.azurewebsites.net/api/vfs/...` calls 401 even with valid publish-profile credentials. Two things that did work with an `az login` session: `az webapp log download --resource-group <rg> --name <app> --log-file logs.zip` (pulls `LogFiles/Application/*-stderr-*.txt`, the actual Node process stderr) via the ARM API rather than Kudu; and hitting the same VFS endpoints with an AAD bearer token instead of basic auth (`az account get-access-token --resource https://management.core.windows.net/`, then `curl -H "Authorization: Bearer $TOKEN" https://<app>.scm.azurewebsites.net/api/vfs/...`) to browse files like the installed Node versions under `D:\Program Files\nodejs\`.

**Bug #1 — "internal server error" on every request, right after first deploy**: `LogFiles/Application/*-stderr-*.txt` contained `SyntaxError: <unknown message reserved_word>` at `Module._compile (module.js:434:25)`, thrown from `C:\Program Files (x86)\iisnode\interceptor.js`. The `module.js`-style stack (old CommonJS loader, not the `internal/modules/cjs/loader.js` modern Node uses) meant **iisnode was launching its own bundled, ancient Node.exe instead of the Node ~24 runtime selected in the portal**, and that old engine can't parse `import`/`export` (backend `package.json` has `"type": "module"`) — hence the reserved-word syntax error. `nodeProcessCommandLine="node.exe"` (relying on PATH) was *not* enough — it kept failing identically even after a full `az webapp restart`. The fix that actually worked was pointing at the concrete installed binary: listed `D:\Program Files\nodejs\` via the VFS/AAD-token trick above, found `24.14.1` was the highest installed 24.x version matching `WEBSITE_NODE_DEFAULT_VERSION=~24`, and set `nodeProcessCommandLine="&quot;D:\Program Files\nodejs\24.14.1\node.exe&quot;"` in the `<iisnode>` element. A custom `web.config` for a Node app on Windows App Service doesn't get the platform's automatic version resolution that an auto-generated one would — that has to be hardcoded, and re-checked if the App Service's Node version is ever changed.

**Bug #2 — API calls returned a generic IIS 500 page instead of the app's own JSON error**: even once Express was running correctly and catching errors in `handleAgentError` (confirmed via the stderr log showing our own `console.error("Unexpected error:", err)` line), the HTTP response body was still IIS's canned "The page cannot be displayed" HTML. IIS's `httpErrors` module replaces the body of any error-status response by default, regardless of what the app already sent. Fix: added `<httpErrors existingResponse="PassThrough" />` inside `<system.webServer>` in `web.config`.

**Bug #3 — once errors were visible, the real one was an auth failure**: `DefaultAzureCredential` on the App Service exhausted its whole chain — `EnvironmentCredential` skipped (no service-principal vars set, as expected), `ManagedIdentityCredential` failed ("IMDS endpoint... not available" — no identity was assigned), then CLI/VS Code/PowerShell/Dev-CLI credentials all failed because those are local-dev-only and there's obviously no interactive session on the App Service. This is the production equivalent of the `az login` fallback local dev relies on. Fix: `az webapp identity assign` to enable a System-assigned Managed Identity, then `az role assignment create --assignee <principalId> --role "Foundry User" --scope <foundry-project-resource-id>` (the project's ARM resource ID looks like `.../Microsoft.CognitiveServices/accounts/<account>/projects/<project>` — found via `az resource list`, since `PROJECT_ENDPOINT` only gives you the data-plane URL, not the ARM resource ID). Note the exact built-in role name in this tenant is **"Foundry User"**, not "Azure AI User" — `az role definition list --query "[?contains(roleName,'Foundry')]"` is how to confirm what's actually available before assigning. Role assignments can take a minute or two to propagate; restart the App Service (`az webapp restart`) after assigning if the first request still 401s/403s.

Packaging a deploy zip:

1. `cd frontend && npm run build` — must happen *after* any `FoundryChat.jsx` change, since `BACKEND_URL` is baked in at build time via `import.meta.env.PROD`.
2. Stage `web.config`, `backend/` (including its `node_modules` — this is a zip deploy with no Oryx build step, so dependencies must already be installed; none of this project's deps have native bindings, so a package installed on macOS is safe to run on Windows App Service), and only `frontend/dist/` (not the frontend source or its dev `node_modules`) into a scratch folder.
3. Exclude `backend/.env` / `.env.example` from the zip — env vars (`PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`) are set directly on the App Service instead (Configuration → Environment variables).
4. Zip the staged folder's *contents* (`web.config`, `backend/`, `frontend/` at the zip root — not a nested wrapper folder), then deploy with `az webapp deploy --resource-group <rg> --name <app> --src-path deploy.zip --type zip`.

## Debugging notes for next time

- "Failed to fetch" in the browser console means the request never completed at the network/CORS layer — check backend CORS config and that the backend is actually running/reachable before suspecting the Azure/Foundry auth layer.
- A 500 with a vague `"Unexpected server error"` body means the real error is in the backend's stdout/stderr log, not the HTTP response (see `handleAgentError` in `server.js` for what does/doesn't get forwarded to the client).
- If `az login` doesn't seem to be picked up, check whether `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` are set in `.env` — their mere presence (even with placeholder values) short-circuits `DefaultAzureCredential`'s fallback chain before it reaches `AzureCliCredential`.
