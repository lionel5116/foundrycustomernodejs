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
npm install        # root, backend/, and frontend/ each need their own install
npm run dev         # from root — starts backend + frontend together
npm run kill         # frees ports 3002 (backend) and 5173 (frontend)
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

## Bugs found and fixed after initial scaffold

- **Port collision on 3001**: an unrelated Next.js dev server on this machine was already bound to port 3001, which was the backend's original default. Moved the backend to **port 3002** everywhere: `backend/.env`, `backend/.env.example`, and the `BACKEND_URL` constant in `frontend/src/FoundryChat.jsx`. Confirm the port is actually free (`lsof -ti :3002`) before assuming a collision is with your own leftover process rather than someone else's server.
- **CORS ("Failed to fetch")**: `server.js` had no CORS middleware, so the browser blocked the frontend's cross-origin JSON POST during preflight. Added the `cors` package and `app.use(cors())` in `backend/server.js`.
- **Placeholder Azure credentials blocking `az login`**: `backend/.env` shipped with literal placeholder values for `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`. `DefaultAzureCredential` tries `EnvironmentCredential` first whenever those vars are *present*, even if they're garbage — so it failed on the fake tenant ID before ever falling through to `AzureCliCredential` (the one that uses `az login`). Fix: leave those three vars commented out/unset in `.env` when relying on `az login` instead of a service principal.
- **Stale Foundry API request shape**: the live Foundry endpoint rejects the `agent` field the original sample code sent (`"The 'agent' property is deprecated. Use 'agent_reference' instead"`). The installed `@azure/ai-projects` SDK accepts either key client-side, but the deployed API requires `agent_reference`. Fixed in `backend/server.js`'s two routes: `{ body: { agent_reference: { name: agentName, type: "agent_reference" } } }`.

## Debugging notes for next time

- "Failed to fetch" in the browser console means the request never completed at the network/CORS layer — check backend CORS config and that the backend is actually running/reachable before suspecting the Azure/Foundry auth layer.
- A 500 with a vague `"Unexpected server error"` body means the real error is in the backend's stdout/stderr log, not the HTTP response (see `handleAgentError` in `server.js` for what does/doesn't get forwarded to the client).
- If `az login` doesn't seem to be picked up, check whether `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` are set in `.env` — their mere presence (even with placeholder values) short-circuits `DefaultAzureCredential`'s fallback chain before it reaches `AzureCliCredential`.
