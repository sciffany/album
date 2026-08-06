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
  tagSharePath,
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

export type ActiveTagShare = {
  id: string;
  token: string;
  tagId: string;
  tagText: string;
  tagSlug: string;
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

export async function getActiveTagShareByToken(
  token: string,
): Promise<ActiveTagShare | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const share = await prisma.tagShare.findFirst({
    where: { token: trimmed, revokedAt: null },
    select: {
      id: true,
      token: true,
      tagId: true,
      tag: { select: { text: true, slug: true } },
    },
  });

  if (!share) return null;

  return {
    id: share.id,
    token: share.token,
    tagId: share.tagId,
    tagText: share.tag.text,
    tagSlug: share.tag.slug,
  };
}

export async function getActiveTagShareByTagId(
  tagId: string,
): Promise<{ id: string; token: string } | null> {
  const share = await prisma.tagShare.findFirst({
    where: { tagId, revokedAt: null },
    select: { id: true, token: true },
  });
  return share;
}

export async function createOrGetTagShare(
  tagSlug: string,
  createdBy?: string,
): Promise<{ token: string; created: boolean }> {
  const slug = tagSlug.trim().toLowerCase();
  if (!slug) {
    throw new Error("Tag not found");
  }

  const tag = await prisma.tag.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tag) {
    throw new Error("Tag not found");
  }

  const existing = await getActiveTagShareByTagId(tag.id);
  if (existing) {
    return { token: existing.token, created: false };
  }

  const token = createShareToken();
  await prisma.tagShare.create({
    data: {
      token,
      tagId: tag.id,
      createdBy: createdBy ?? null,
    },
  });
  return { token, created: true };
}

export async function revokeTagShare(tagSlug: string): Promise<boolean> {
  const slug = tagSlug.trim().toLowerCase();
  if (!slug) {
    throw new Error("Tag not found");
  }

  const tag = await prisma.tag.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tag) {
    throw new Error("Tag not found");
  }

  const result = await prisma.tagShare.updateMany({
    where: { tagId: tag.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** True when an active media row with this key has the shared tag. */
export async function isMediaTaggedInShare(
  s3Key: string,
  share: ActiveTagShare,
): Promise<boolean> {
  const media = await prisma.media.findFirst({
    where: {
      s3Key,
      deletedAt: null,
      tags: { some: { tagId: share.tagId } },
    },
    select: { id: true },
  });
  return Boolean(media);
}

/** Authorize guest media access via folder or tag share token. */
export async function canAccessMediaViaShareToken(
  s3Key: string,
  token: string,
): Promise<boolean> {
  const folderShare = await getActiveShareByToken(token);
  if (folderShare && (await isMediaUnderShare(s3Key, folderShare))) {
    return true;
  }
  const tagShare = await getActiveTagShareByToken(token);
  if (tagShare && (await isMediaTaggedInShare(s3Key, tagShare))) {
    return true;
  }
  return false;
}
