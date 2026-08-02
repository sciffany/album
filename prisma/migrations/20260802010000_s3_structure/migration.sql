-- Structure moves to S3; media rows only store captions/tags keyed by object key.

ALTER TABLE "media" DROP CONSTRAINT IF EXISTS "media_folder_id_fkey";
DROP TABLE IF EXISTS "folders";

TRUNCATE TABLE "media_tags", "media";

DROP INDEX IF EXISTS "media_date_taken_idx";
DROP INDEX IF EXISTS "media_search_vector_idx";

ALTER TABLE "media" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "media" DROP COLUMN IF EXISTS "folder_id";
ALTER TABLE "media" DROP COLUMN IF EXISTS "source";
ALTER TABLE "media" DROP COLUMN IF EXISTS "url";
ALTER TABLE "media" DROP COLUMN IF EXISTS "thumbnail_path";
ALTER TABLE "media" DROP COLUMN IF EXISTS "date_added";
ALTER TABLE "media" DROP COLUMN IF EXISTS "date_taken";
ALTER TABLE "media" DROP COLUMN IF EXISTS "media_type";

ALTER TABLE "media" ADD COLUMN "s3_key" TEXT NOT NULL;

CREATE UNIQUE INDEX "media_s3_key_key" ON "media"("s3_key");

DROP TYPE IF EXISTS "Source";
DROP TYPE IF EXISTS "MediaType";

-- Full-text search on captions
ALTER TABLE "media" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(caption, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(ai_caption, '')), 'B')
  ) STORED;

CREATE INDEX media_search_vector_idx ON "media" USING GIN (search_vector);
