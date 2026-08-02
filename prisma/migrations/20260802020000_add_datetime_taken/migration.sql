-- Capture time for media (populated separately from EXIF / sync script).
ALTER TABLE "media" ADD COLUMN "datetime_taken" TIMESTAMP(3);

CREATE INDEX "media_datetime_taken_idx" ON "media"("datetime_taken");
