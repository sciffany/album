# Album

Personal photo tagging library with folders, inline tags/captions, and search.

## Stack

- Next.js (App Router) + React + Tailwind
- Prisma + Neon (PostgreSQL)
- Auth.js (Google OAuth + email allowlist)
- Postgres full-text search on captions

## Setup

1. Copy env and fill in Neon + Google OAuth values:

```bash
cp .env.example .env
```

2. In [Neon](https://neon.tech), create a project and set:

- `DATABASE_URL` — pooled connection string
- `DIRECT_URL` — direct connection string (for migrations)

3. Create a Google OAuth client (Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`) and set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

4. Set `ALLOWED_EMAILS` to your Google email (comma-separated for multiple).

5. Generate `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

6. Apply migrations and seed sample data:

```bash
npm install
npx prisma migrate deploy
npm run db:seed
```

7. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## App routes

- `/login` — Google sign-in
- `/browse` — root folders
- `/browse/Family/2024/Japan%20Trip` — nested folder by path
- `/search?q=tokyo&from=2024-01-01&to=2024-12-31` — tags, captions (FTS), dateTaken

## Ingestion

Populate `folders`, `media`, `tags`, and `media_tags` with your own script. Keep `folders.path` denormalized (e.g. `Family/2024/Japan Trip`) when creating nested folders.
