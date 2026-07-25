---
name: zip-and-deploy
description: Build the frontend, package backend + frontend/dist + web.config into deploy.zip, and ship it to the rav4virtualagent Azure App Service via az webapp deploy. Use when the user asks to deploy, redeploy, ship, or package this app for Azure, or says "zip and deploy".
metadata:
  priority: 8
---

# Zip and deploy to Azure App Service

This project runs as **one** Windows App Service (`rav4virtualagent`, resource group
`rg-rav4-support-virtual-agent`) hosting both halves via `iisnode`. There is no CI/CD —
deploys are a manual zip push. Defaults below are this project's actual values; ask the
user before assuming a different app/resource-group name.

## Preflight

```bash
az account show   # confirm logged into the right subscription/tenant
```

If not logged in, tell the user to run `az login` — don't attempt it yourself.

## 1. Build the frontend

```bash
cd frontend && npm run build
```

Must happen *after* any change to `frontend/src/FoundryChat.jsx`, since `BACKEND_URL`
(`import.meta.env.PROD ? "" : "http://localhost:3002"`) is baked in at build time.

## 2. Stage the deploy package

Only stage what production actually needs — not the full repo:

```bash
STAGE="$(mktemp -d)/deploy"
ROOT="$(git rev-parse --show-toplevel)"
mkdir -p "$STAGE/backend" "$STAGE/frontend"

cp "$ROOT/web.config" "$STAGE/web.config"

# backend: everything except secrets (env vars live in App Service settings, not the zip)
rsync -a --exclude='.env' --exclude='.env.example' "$ROOT/backend/" "$STAGE/backend/"

# frontend: only the built static output, not source or dev node_modules
cp -R "$ROOT/frontend/dist" "$STAGE/frontend/dist"
```

`backend/node_modules` **must** be included and pre-installed — this is a zip deploy with
no Oryx build step, so nothing gets `npm install`ed server-side. None of this project's
dependencies have native bindings, so a `node_modules` installed on macOS/Linux is safe
to ship to the Windows App Service as-is.

## 3. Zip it

Zip the staged folder's *contents* at the root — not a nested wrapper directory:

```bash
cd "$STAGE" && zip -r -X -q /path/to/deploy.zip web.config backend frontend
```

`deploy.zip` at the repo root is gitignored — regenerate it each time, don't rely on a
stale copy.

## 4. Deploy

```bash
az webapp deploy \
  --resource-group rg-rav4-support-virtual-agent \
  --name rav4virtualagent \
  --src-path deploy.zip \
  --type zip
```

This is a live production deploy — confirm with the user before running it, unless
they've already asked explicitly for this run (e.g. "zip and deploy").

## 5. Verify

```bash
curl -s -o /dev/null -w "homepage: %{http_code}\n" https://rav4virtualagent.azurewebsites.net/
curl -s -o /dev/null -w "api: %{http_code}\n" -X POST https://rav4virtualagent.azurewebsites.net/api/agent/start \
  -H "Content-Type: application/json" -d '{"text":"hello"}'
```

Expect `200` on both. If either isn't 200, go straight to Troubleshooting — don't
re-deploy blind.

## Troubleshooting

Kudu's SCM basic auth is disabled on this site, so `https://rav4virtualagent.scm.azurewebsites.net/api/vfs/...`
401s with publish-profile creds. Two things that do work:

**Pull real stderr logs** (bypasses Kudu, uses the ARM API instead):

```bash
az webapp log download --resource-group rg-rav4-support-virtual-agent --name rav4virtualagent --log-file logs.zip
unzip -o logs.zip -d logs
cat logs/LogFiles/Application/*-stderr-*.txt
```

**Browse the site's filesystem via Kudu with an AAD bearer token** (works even though
basic auth doesn't):

```bash
TOKEN=$(az account get-access-token --resource https://management.core.windows.net/ --query accessToken -o tsv)
curl -s -H "Authorization: Bearer $TOKEN" "https://rav4virtualagent.scm.azurewebsites.net/api/vfs/site/wwwroot/web.config"
```

### Known failure modes already hit once (see CLAUDE.md for full history)

- **Generic IIS 500 on every request** → check stderr log for `SyntaxError: <unknown
  message reserved_word>` from `iisnode\interceptor.js`. Means iisnode launched its own
  ancient bundled Node instead of the selected runtime. Fix is in `web.config`'s
  `nodeProcessCommandLine` — must be an absolute path to a real installed `node.exe`
  under `D:\Program Files\nodejs\<version>\` (found via the VFS browse trick above), not
  just the bare `"node.exe"` (that alone does not reliably resolve via PATH here).
- **500 but body is IIS's canned error page, not your app's JSON** → `web.config` needs
  `<httpErrors existingResponse="PassThrough" />` inside `<system.webServer>`, or IIS
  replaces any error-status body regardless of what Express sent.
- **401/403 from the Foundry call itself, or `DefaultAzureCredential` exhausting its
  whole chain in the stderr log** → the App Service's Managed Identity either isn't
  enabled or isn't granted the **Foundry User** role (that's the exact built-in role name
  in this tenant — confirm with `az role definition list --query "[?contains(roleName,'Foundry')]"`
  before assuming a different name) on the Foundry project resource
  (`/subscriptions/.../resourceGroups/rg-lionel-6322/providers/Microsoft.CognitiveServices/accounts/lionel-7414-resource/projects/lionel-7414`).
  Already fixed once via `az webapp identity assign` + `az role assignment create` — if it
  regresses, check those two are still in place before redoing them.

=> file: ../../../CLAUDE.md — full narrative of every bug hit during the first deploy
