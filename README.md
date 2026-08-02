# Album

Personal photo tagging library. Folder structure and media files come from an S3 bucket; Postgres only stores tags, captions, and AI captions.

## Stack

- Next.js (App Router) + React + Tailwind
- Prisma + Neon (PostgreSQL)
- Auth.js (Google OAuth + email allowlist)
- AWS S3 or Backblaze B2 (listing + private object URLs via presign)
- Postgres full-text search on captions

## Setup

1. Copy env and fill in Neon + Google OAuth + storage values:

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

6. Set object storage for the library bucket (prefixes are folders, objects are media):

- `STORAGE_PROVIDER` — `s3` (AWS, default) or `b2` (Backblaze B2)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — AWS keys, or B2 application key id/secret
- `AWS_REGION` — AWS region, or B2 region code (e.g. `us-west-004`)
- `S3_BUCKET` — private bucket name
- `S3_ENDPOINT` (optional) — custom S3 API URL; for B2 this defaults to `https://s3.<AWS_REGION>.backblazeb2.com`

7. Apply migrations and seed sample tags:

```bash
npm install
npx prisma migrate deploy
npm run db:seed
```

8. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## App routes

- `/login` — Google sign-in
- `/browse` — S3 bucket root
- `/browse/Family/2024/Japan%20Trip` — nested S3 prefix
- `/search?q=tokyo` — tags, captions (FTS), and S3 key match
- `/trash` — recycle bin (soft-deleted objects under `_trash/`)
- `/api/s3/object?key=…` — auth-gated redirect to a presigned S3 GET URL

## Move & soft delete

Browse actions can **move** files/folders (S3 copy + delete, then update `media.s3_key`) and **soft-delete** them into a reserved `_trash/<timestamp>-<id>/…` prefix. Soft-deleted items disappear from library browse/search and appear on `/trash` for restore or permanent purge. Your storage credentials need write + delete permission on the bucket (B2: `writeFiles` + `deleteFiles`).

## Data model

| Concern | Source |
|---------|--------|
| Folders / hierarchy | S3 prefixes (`ListObjectsV2` + `Delimiter=/`) |
| Media files / URLs | S3 object keys (presigned for display and open) |
| Tags, captions, AI captions, `datetime_taken` | Postgres `media` + `tags` + `media_tags`, keyed by `s3_key` |

Editing a caption or tags upserts a `media` row for that S3 key. Objects with no row yet still appear in browse with empty metadata. Browse/search display and sort use `datetime_taken` (not S3 upload/`LastModified`).

## Sync capture times from EXIF

Populate `datetime_taken` from B2/S3 object metadata (EXIF `DateTimeOriginal`, falling back to CreateDate / QuickTime dates):

```bash
npm run sync:datetime
# optional:
npm run sync:datetime -- --prefix=Family/2024
npm run sync:datetime -- --dry-run --limit=20
npm run sync:datetime -- --force
```

Uses the same `STORAGE_PROVIDER` / AWS_* / `S3_BUCKET` / `DATABASE_URL` env vars as the app. By default, keys that already have `datetime_taken` are skipped.
