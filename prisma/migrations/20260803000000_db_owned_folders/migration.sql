-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "path" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add display name + folder FK (name backfilled before NOT NULL)
ALTER TABLE "media" ADD COLUMN "folder_id" TEXT;
ALTER TABLE "media" ADD COLUMN "name" TEXT;

-- Backfill display names from library path (prefer pre-trash original key)
UPDATE "media"
SET "name" = COALESCE(
  NULLIF(substring(COALESCE("original_s3_key", "s3_key") FROM '[^/]+$'), ''),
  "s3_key"
);

ALTER TABLE "media" ALTER COLUMN "name" SET NOT NULL;

-- Drop soft-delete original-key column (trash is DB-only going forward)
ALTER TABLE "media" DROP COLUMN "original_s3_key";

-- CreateIndex
CREATE INDEX "folders_path_idx" ON "folders"("path");

-- Active folders only — soft-deleted paths can be reused
CREATE UNIQUE INDEX "folders_path_active_key" ON "folders"("path") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "folders_parent_id_idx" ON "folders"("parent_id");

-- CreateIndex
CREATE INDEX "folders_deleted_at_idx" ON "folders"("deleted_at");

-- Active children: unique name under a parent
CREATE UNIQUE INDEX "folders_parent_id_name_active_key"
  ON "folders"("parent_id", "name")
  WHERE "deleted_at" IS NULL AND "parent_id" IS NOT NULL;

CREATE UNIQUE INDEX "folders_root_name_active_key"
  ON "folders"("name")
  WHERE "deleted_at" IS NULL AND "parent_id" IS NULL;

-- CreateIndex
CREATE INDEX "media_folder_id_idx" ON "media"("folder_id");

CREATE INDEX "media_folder_id_name_idx" ON "media"("folder_id", "name");

-- Active media only: allow soft-deleted names to be reused after restore/purge.
-- Folder-scoped uniqueness is safe to create now (no rows have folder_id yet).
-- Root uniqueness (`media_root_name_active_key`) is created by backfill-folders.ts
-- AFTER folder_id is assigned — otherwise duplicate basenames across folders
-- (all still folder_id IS NULL here) collide on name alone.
CREATE UNIQUE INDEX "media_folder_id_name_active_key"
  ON "media"("folder_id", "name")
  WHERE "deleted_at" IS NULL AND "folder_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
