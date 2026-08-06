-- CreateTable
CREATE TABLE "folder_shares" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "folder_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "folder_shares_token_key" ON "folder_shares"("token");

-- CreateIndex
CREATE INDEX "folder_shares_folder_id_idx" ON "folder_shares"("folder_id");

-- One active share per folder
CREATE UNIQUE INDEX "folder_shares_folder_id_active_key" ON "folder_shares"("folder_id") WHERE "revoked_at" IS NULL;

-- AddForeignKey
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
