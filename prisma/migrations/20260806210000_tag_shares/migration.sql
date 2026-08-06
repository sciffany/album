-- CreateTable
CREATE TABLE "tag_shares" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "tag_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_shares_token_key" ON "tag_shares"("token");

-- CreateIndex
CREATE INDEX "tag_shares_tag_id_idx" ON "tag_shares"("tag_id");

-- One active share per tag
CREATE UNIQUE INDEX "tag_shares_tag_id_active_key" ON "tag_shares"("tag_id") WHERE "revoked_at" IS NULL;

-- AddForeignKey
ALTER TABLE "tag_shares" ADD CONSTRAINT "tag_shares_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
