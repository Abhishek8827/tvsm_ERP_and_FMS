# TVSM School ERP and Financial Management System

MERN app in plain JavaScript: `apps/api` (Express + Mongoose), `apps/web` (React + Vite + Tailwind), `packages/shared` (money, financial year, roles). Read `DECISIONS.md` for every confirmed business rule.

## One-time setup

You need Node 22.9 or newer, pnpm (`npm i -g pnpm`), a MongoDB Atlas cluster and a Firebase project.

### 1. MongoDB Atlas

1. Atlas > Database > Connect > Drivers > copy the connection string.
2. Atlas > Network Access > add your current IP address.
3. Put the string in `apps/api/.env` as `MONGODB_URI` (copy `apps/api/.env.example` to `apps/api/.env`).

### 2. Firebase (free Spark plan is enough)

1. console.firebase.google.com > Add project.
2. Build > Authentication > Get started > Sign-in method > enable **Email/Password**.
3. Project settings (gear) > General > Your apps > add a **Web app** > copy the config values into `apps/web/.env.local` (copy `apps/web/.env.example` first; the file does not exist until you create it).
4. Project settings > Service accounts > **Generate new private key**. Keep the downloaded JSON file OUT of the repo.
5. Convert it to base64 and put the result in `apps/api/.env` as `FIREBASE_ADMIN_SA_JSON_B64`, and set `FIREBASE_PROJECT_ID`:
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\key.json"))`
   - Mac/Linux: `base64 -w0 key.json`

### 3. Create the login accounts

Fill the `SEED_*` values in `apps/api/.env` (choose new strong passwords), then:

```bash
pnpm install                      # run again after every git pull
pnpm --filter @erp/api users:seed
```

## Run

```bash
pnpm dev          # API on http://localhost:4000, web on http://localhost:5173
```

Open http://localhost:5173 and sign in. After 10 minutes without activity you are signed out automatically.

## Checks

```bash
pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Never commit `.env` files or the Firebase JSON key. Never paste secrets in chat.
