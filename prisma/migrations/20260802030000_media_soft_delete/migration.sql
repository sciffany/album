-- Soft-delete / recycle-bin metadata for media objects moved under `_trash/`.
ALTER TABLE "media" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "media" ADD COLUMN "original_s3_key" TEXT;

CREATE INDEX "media_deleted_at_idx" ON "media"("deleted_at");
