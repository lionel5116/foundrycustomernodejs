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

## Debugging notes for next time

- "Failed to fetch" in the browser console means the request never completed at the network/CORS layer — check backend CORS config and that the backend is actually running/reachable before suspecting the Azure/Foundry auth layer.
- A 500 with a vague `"Unexpected server error"` body means the real error is in the backend's stdout/stderr log, not the HTTP response (see `handleAgentError` in `server.js` for what does/doesn't get forwarded to the client).
- If `az login` doesn't seem to be picked up, check whether `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` are set in `.env` — their mere presence (even with placeholder values) short-circuits `DefaultAzureCredential`'s fallback chain before it reaches `AzureCliCredential`.
