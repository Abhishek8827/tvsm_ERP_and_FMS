# TVSM School ERP and Financial Management System

Monorepo: `apps/api` (Express + Mongoose), `apps/web` (React + Vite + Tailwind), `packages/shared` (money, financial year, roles).

## Run locally

Prerequisites: Node 20+, pnpm, Docker Desktop.

```bash
pnpm install
docker compose up -d                # MongoDB replica set on localhost:27017
cp .env.example apps/api/.env       # then edit values
pnpm dev                            # API on :4000, web on :5173
```

Open http://localhost:5173. In development you pick a role on the first screen (Step 1 stand-in; real login arrives in Step 2).

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

## Rules

Read `DECISIONS.md` for every business rule that has been confirmed. Do not commit secrets; never paste them in chat.
