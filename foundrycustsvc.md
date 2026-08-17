# FoundryCustSvc — Application Description

## What it is

A chat web app that lets a user talk to a Microsoft Foundry agent (e.g. a customer-support agent). The user types messages in a browser chat widget; every message is relayed through a small Node/Express backend to a Foundry agent hosted in an Azure AI Foundry project, and the agent's reply is streamed back into the chat.

## Why it's split into two halves

The browser never talks to Azure directly. Foundry access requires Azure credentials (a service principal or a signed-in Azure identity), and those credentials must never be exposed to client-side code. So the app is split:

- **`backend/`** — holds the Azure credentials and the Foundry project endpoint, and is the only thing that calls Azure.
- **`frontend/`** — a plain UI that only ever calls the backend's own API, never Azure.

This is a standard "confidential client" pattern: the frontend is public/untrusted, the backend is the trusted boundary that owns the secrets.

## Structure

```
backend/    Express API (server.js) — the only thing that talks to Foundry via @azure/ai-projects
frontend/   Vite + React (JS, not TypeScript) app — chat UI in FoundryChat.jsx
package.json (root)   concurrently scripts to run/kill both together for local dev
web.config             IIS/iisnode config, used only when deploying both halves as one Azure App Service
```

### Backend (`backend/server.js`)

An Express app with two API routes plus static-file serving:

- `POST /api/agent/start` — first message of a conversation. Creates a new Foundry conversation (`openAIClient.conversations.create`), runs the agent against it (`openAIClient.responses.create`), and returns `{ conversationId, reply }`.
- `POST /api/agent/message` — every message after the first. Appends the message to the existing Foundry conversation and runs the agent again, returning `{ reply }`.
- Both routes select the agent via `{ body: { agent_reference: { name: agentName, type: "agent_reference" } } }`, where `agentName` comes from `FOUNDRY_AGENT_NAME` in `backend/.env`.
- `handleAgentError` maps Azure REST failures (401 auth failure, 403 missing role assignment, 404 bad agent name) into actionable JSON error responses for the frontend, instead of leaking raw Azure errors.
- Also serves the built frontend (`express.static` + a catch-all route to `frontend/dist/index.html`), registered *after* the API routes — this is only exercised in the combined single-App-Service deployment, not in local dev.
- Runs on **port 3002** locally (env var `PORT`, default 3001 in code but overridden to 3002 in `.env`).
- Authenticates to Azure with `DefaultAzureCredential` (from `@azure/identity`) — no API key. It tries, in order: env-var service principal (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`, if all three are set), then Azure CLI login (`az login`), then other fallbacks (managed identity, etc.) that only apply in Azure-hosted environments.

### Frontend (`frontend/src/FoundryChat.jsx`)

A single React chat widget:

- Holds `conversationId` in React state (nothing persisted — refreshing the page starts a new Foundry conversation).
- No `conversationId` yet → `POST`s `{ text }` to `/api/agent/start`.
- Has a `conversationId` → `POST`s `{ conversationId, text }` to `/api/agent/message`.
- Appends each `reply` to the message list and re-renders.
- Talks to the backend at `BACKEND_URL`, which is `http://localhost:3002` in dev and a same-origin relative path (`""`) in production (`import.meta.env.PROD`), since production serves frontend and backend from the same Express process.

## Local development

```
npm run install:all   # installs root, backend/, and frontend/ deps
npm run dev            # starts backend (:3002) + frontend (:5173) together
npm run kill            # frees ports 3002 and 5173 if something's stuck
```

Backend alone: `cd backend && cp .env.example .env && npm start`.
Frontend alone: `cd frontend && npm run dev`.

## Deployment

Can also be deployed as a single Windows Azure App Service (iisnode) running one Node process that serves both the API and the built frontend static files, using `web.config` to route requests through iisnode to `backend/server.js`. See `CLAUDE.md` for the full deployment procedure, known pitfalls (iisnode Node version pinning, IIS error-body passthrough, managed-identity role assignment), and the `zip-and-deploy` skill that automates packaging and shipping the zip.
