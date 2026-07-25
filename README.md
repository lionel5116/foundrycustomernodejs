# Foundry Customer Chat

A Microsoft Foundry agent chat app split into two independent apps:

- **backend/** — Express API that talks to your Foundry agent via `@azure/ai-projects`.
- **frontend/** — Plain React (Vite) app that renders the `FoundryChat` widget.

## Backend

```
cd backend
npm install
cp .env.example .env   # fill in your real values
npm start
```

Runs on `http://localhost:3002` by default (chosen to avoid colliding with other local dev servers on 3001). Exposes:

- `POST /api/agent/start` — start a new conversation (`{ text }`)
- `POST /api/agent/message` — continue a conversation (`{ conversationId, text }`)

Requires `PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`, and Azure service principal credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) — see `backend/.env.example`.

## Frontend

```
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173`. `src/FoundryChat.jsx` points at `BACKEND_URL = "http://localhost:3002"` — update that constant if the backend runs elsewhere.

## Install everything at once

From the project root:

```
npm run install:all
```

Installs root, `backend/`, and `frontend/` dependencies in one command. Still need to `cp backend/.env.example backend/.env` and fill in values before running.

## Run both

After installing dependencies (see above) and setting up `backend/.env`, from the project root:

```
npm run dev
```

This uses `concurrently` to start the backend and frontend together in one terminal.

## Stop both

```
npm run kill
```

Frees ports 3002 (backend) and 5173 (frontend) by killing whatever is bound to them.
