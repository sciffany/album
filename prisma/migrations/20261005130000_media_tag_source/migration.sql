-- Distinguish handmade tags from ones written by the folder AI tagging button.
ALTER TABLE "media_tags" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';
