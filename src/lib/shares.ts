import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { isPathUnderShareRoot } from "@/lib/share-paths";
import {
  assertValidFolderPath,
  isTrashFolderPath,
} from "@/lib/storage-keys";

export {
  SHARE_COOKIE_NAME,
  sharePath,
  resolveShareBrowsePath,
  relativePathFromShareRoot,
  isPathUnderShareRoot,
} from "@/lib/share-paths";

export type ActiveShare = {
  id: string;
  token: string;
  folderId: string;
  folderPath: string;
  folderName: string;
};

export function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function getActiveShareByToken(
  token: string,
): Promise<ActiveShare | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const share = await prisma.folderShare.findFirst({
    where: { token: trimmed, revokedAt: null },
    select: {
      id: true,
      token: true,
      folderId: true,
      folder: { select: { path: true, name: true, deletedAt: true } },
    },
  });

  if (!share || share.folder.deletedAt) return null;

  return {
    id: share.id,
    token: share.token,
    folderId: share.folderId,
    folderPath: share.folder.path,
    folderName: share.folder.name,
  };
}

export async function getActiveShareByFolderId(
  folderId: string,
): Promise<{ id: string; token: string } | null> {
  const share = await prisma.folderShare.findFirst({
    where: { folderId, revokedAt: null },
    select: { id: true, token: true },
  });
  return share;
}

export async function createOrGetFolderShare(
  folderPath: string,
  createdBy?: string,
): Promise<{ token: string; created: boolean }> {
  const path = assertValidFolderPath(folderPath || "", "folder path");
  if (!path) {
    throw new Error("Cannot share the library root");
  }
  if (isTrashFolderPath(path)) {
    throw new Error("Cannot share trash");
  }

  const folder = await prisma.folder.findFirst({
    where: { path, deletedAt: null },
    select: { id: true },
  });
  if (!folder) {
    throw new Error("Folder not found");
  }

  const existing = await getActiveShareByFolderId(folder.id);
  if (existing) {
    return { token: existing.token, created: false };
  }

  const token = createShareToken();
  await prisma.folderShare.create({
    data: {
      token,
      folderId: folder.id,
      createdBy: createdBy ?? null,
    },
  });
  return { token, created: true };
}

export async function revokeFolderShare(folderPath: string): Promise<boolean> {
  const path = assertValidFolderPath(folderPath || "", "folder path");
  if (!path) {
    throw new Error("Cannot share the library root");
  }

  const folder = await prisma.folder.findFirst({
    where: { path, deletedAt: null },
    select: { id: true },
  });
  if (!folder) {
    throw new Error("Folder not found");
  }

  const result = await prisma.folderShare.updateMany({
    where: { folderId: folder.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** True when an active media row with this key sits under the shared folder tree. */
export async function isMediaUnderShare(
  s3Key: string,
  share: ActiveShare,
): Promise<boolean> {
  const media = await prisma.media.findFirst({
    where: { s3Key, deletedAt: null },
    select: {
      folderId: true,
      folder: { select: { path: true, deletedAt: true } },
    },
  });

  if (!media?.folderId || !media.folder || media.folder.deletedAt) {
    return false;
  }

  return isPathUnderShareRoot(share.folderPath, media.folder.path);
}
