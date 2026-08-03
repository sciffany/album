"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createFolder,
  listChildFolderPaths,
  moveFolderPrefix,
  moveMediaToFolder,
  purgeMediaObject,
  renameFolder,
  renameMedia,
  resolveUploadKeys,
  restoreMediaObject,
  softDeleteFolderPrefix,
  softDeleteMediaObject,
  type UploadPresignRequest,
} from "@/lib/media-ops";
import { prisma } from "@/lib/prisma";
import { getBucket, objectExists, presignPutObject } from "@/lib/s3";
import { findOrCreateTags } from "@/lib/tags";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

function revalidateLibrary() {
  revalidatePath("/browse", "layout");
  revalidatePath("/search");
  revalidatePath("/trash");
}

async function ensureMedia(s3Key: string) {
  const key = s3Key.trim();
  if (!key || key.includes("\0") || key.startsWith("/")) {
    throw new Error("Invalid S3 key");
  }
  return prisma.media.upsert({
    where: { s3Key: key },
    create: { s3Key: key },
    update: {},
  });
}

export async function updateCaption(s3Key: string, caption: string) {
  await requireUser();
  const media = await ensureMedia(s3Key);

  await prisma.media.update({
    where: { id: media.id },
    data: { caption: caption.trim() || null },
  });

  revalidateLibrary();
}

export async function setMediaTags(s3Key: string, tagTexts: string[]) {
  await requireUser();
  const media = await ensureMedia(s3Key);

  const tags = await findOrCreateTags(tagTexts);
  const tagIds = new Set(tags.map((t) => t.id));

  const existing = await prisma.mediaTag.findMany({
    where: { mediaId: media.id },
  });

  const toDelete = existing.filter((mt) => !tagIds.has(mt.tagId));
  const existingTagIds = new Set(existing.map((mt) => mt.tagId));
  const toCreate = tags.filter((t) => !existingTagIds.has(t.id));

  await prisma.$transaction([
    ...toDelete.map((mt) =>
      prisma.mediaTag.delete({
        where: { mediaId_tagId: { mediaId: media.id, tagId: mt.tagId } },
      }),
    ),
    ...toCreate.map((t) =>
      prisma.mediaTag.create({
        data: { mediaId: media.id, tagId: t.id },
      }),
    ),
  ]);

  revalidateLibrary();
}

export async function moveMediaAction(
  fromKey: string,
  destinationFolder: string,
  fileName?: string,
) {
  await requireUser();
  const result = await moveMediaToFolder(fromKey, destinationFolder, fileName);
  revalidateLibrary();
  return result;
}

export async function moveFolderAction(fromPath: string, toPath: string) {
  await requireUser();
  const result = await moveFolderPrefix(fromPath, toPath);
  revalidateLibrary();
  return result;
}

export async function renameMediaAction(fromKey: string, newName: string) {
  await requireUser();
  try {
    const result = await renameMedia(fromKey, newName);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not rename file"),
    };
  }
}

export async function renameFolderAction(fromPath: string, newName: string) {
  await requireUser();
  try {
    const result = await renameFolder(fromPath, newName);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not rename folder"),
    };
  }
}

function actionError(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function softDeleteMediaAction(s3Key: string) {
  await requireUser();
  try {
    const trashKey = await softDeleteMediaObject(s3Key);
    revalidateLibrary();
    return { ok: true as const, trashKey };
  } catch (err) {
    return { ok: false as const, error: actionError(err, "Could not delete file") };
  }
}

export async function softDeleteFolderAction(folderPath: string) {
  await requireUser();
  try {
    const result = await softDeleteFolderPrefix(folderPath);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not delete folder"),
    };
  }
}

export async function restoreMediaAction(
  trashKey: string,
  destinationKey?: string,
) {
  await requireUser();
  try {
    const result = await restoreMediaObject(trashKey, destinationKey);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return { ok: false as const, error: actionError(err, "Could not restore") };
  }
}

export async function purgeMediaAction(trashKey: string) {
  await requireUser();
  try {
    await purgeMediaObject(trashKey);
    revalidateLibrary();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: actionError(err, "Could not delete") };
  }
}

export async function listFoldersAction(path: string) {
  await requireUser();
  return listChildFolderPaths(path);
}

export async function createFolderAction(parentPath: string, name: string) {
  await requireUser();
  try {
    const result = await createFolder(parentPath, name);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not create folder"),
    };
  }
}

export async function presignUploadsAction(
  destinationFolder: string,
  files: UploadPresignRequest[],
) {
  await requireUser();
  try {
    const resolved = resolveUploadKeys(destinationFolder, files);
    const bucket = getBucket();
    const uploads = [];

    for (const file of resolved) {
      if (await objectExists(file.key)) {
        return {
          ok: false as const,
          error: `Already exists: ${file.key}`,
        };
      }
      const url = await presignPutObject(bucket, file.key, file.contentType);
      uploads.push({
        key: file.key,
        url,
        contentType: file.contentType,
      });
    }

    return { ok: true as const, uploads };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not prepare upload"),
    };
  }
}

/** Call after client PUTs succeed so browse/search caches refresh. */
export async function completeUploadsAction(keys: string[]) {
  await requireUser();
  try {
    for (const key of keys) {
      const trimmed = key.trim();
      if (!trimmed || trimmed.includes("\0") || trimmed.startsWith("/")) {
        throw new Error("Invalid S3 key");
      }
      await prisma.media.upsert({
        where: { s3Key: trimmed },
        create: { s3Key: trimmed },
        update: {},
      });
    }
    revalidateLibrary();
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: actionError(err, "Could not finish upload"),
    };
  }
}
