"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createFolder,
  ensureFolderPath,
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
import { assertValidKey, baseName, normalizeFolderPath } from "@/lib/storage-keys";
import { findOrCreateTags, slugifyTag } from "@/lib/tags";

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
  const key = assertValidKey(s3Key);
  const existing = await prisma.media.findUnique({ where: { s3Key: key } });
  if (existing) return existing;
  return prisma.media.create({
    data: {
      s3Key: key,
      name: baseName(key),
      folderId: null,
    },
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

/** Move many files and folders; continues after per-item failures. */
export async function moveItemsBulkAction(
  items: { files: string[]; folders: string[] },
  destinationFolder: string,
) {
  await requireUser();
  const dest = normalizeFolderPath(destinationFolder || "");
  let moved = 0;
  const errors: { key: string; message: string }[] = [];

  for (const path of items.folders) {
    try {
      const name = baseName(path);
      const toPath = dest ? `${dest}/${name}` : name;
      await moveFolderPrefix(path, toPath);
      moved += 1;
    } catch (err) {
      errors.push({
        key: path,
        message: actionError(err, "Could not move folder"),
      });
    }
  }

  for (const key of items.files) {
    try {
      await moveMediaToFolder(key, dest);
      moved += 1;
    } catch (err) {
      errors.push({
        key,
        message: actionError(err, "Could not move file"),
      });
    }
  }

  revalidateLibrary();
  return { moved, errors };
}

export async function addMediaTagsBulk(s3Keys: string[], tagTexts: string[]) {
  await requireUser();
  const tags = await findOrCreateTags(tagTexts);
  if (tags.length === 0 || s3Keys.length === 0) {
    return;
  }

  const mediaRows = [];
  for (const key of s3Keys) {
    mediaRows.push(await ensureMedia(key));
  }

  const existing = await prisma.mediaTag.findMany({
    where: {
      mediaId: { in: mediaRows.map((m) => m.id) },
      tagId: { in: tags.map((t) => t.id) },
    },
  });
  const existingSet = new Set(
    existing.map((row) => `${row.mediaId}:${row.tagId}`),
  );

  const toCreate = [];
  for (const media of mediaRows) {
    for (const tag of tags) {
      const pair = `${media.id}:${tag.id}`;
      if (!existingSet.has(pair)) {
        toCreate.push({ mediaId: media.id, tagId: tag.id });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.mediaTag.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  revalidateLibrary();
}

export async function removeMediaTagsBulk(
  s3Keys: string[],
  tagTexts: string[],
) {
  await requireUser();
  if (s3Keys.length === 0 || tagTexts.length === 0) {
    return;
  }

  const slugs = [
    ...new Set(
      tagTexts
        .map((t) => slugifyTag(t))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
  if (slugs.length === 0) return;

  const [tags, mediaRows] = await Promise.all([
    prisma.tag.findMany({ where: { slug: { in: slugs } } }),
    prisma.media.findMany({ where: { s3Key: { in: s3Keys } } }),
  ]);

  if (tags.length === 0 || mediaRows.length === 0) return;

  await prisma.mediaTag.deleteMany({
    where: {
      mediaId: { in: mediaRows.map((m) => m.id) },
      tagId: { in: tags.map((t) => t.id) },
    },
  });

  revalidateLibrary();
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
  s3Key: string,
  destinationFolder?: string,
) {
  await requireUser();
  try {
    const result = await restoreMediaObject(s3Key, destinationFolder);
    revalidateLibrary();
    return { ok: true as const, ...result };
  } catch (err) {
    return { ok: false as const, error: actionError(err, "Could not restore") };
  }
}

export async function purgeMediaAction(s3Key: string) {
  await requireUser();
  try {
    await purgeMediaObject(s3Key);
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
      // Reject display-name collisions in the destination folder.
      const folderId = await ensureFolderPath(file.folderPath);
      const clash = await prisma.media.findFirst({
        where: {
          folderId,
          name: file.name,
          deletedAt: null,
        },
      });
      if (clash) {
        return {
          ok: false as const,
          error: `Already exists: ${file.folderPath ? `${file.folderPath}/` : ""}${file.name}`,
        };
      }
      if (await objectExists(file.key)) {
        return {
          ok: false as const,
          error: `Storage key collision; retry upload`,
        };
      }
      const url = await presignPutObject(bucket, file.key, file.contentType);
      uploads.push({
        key: file.key,
        url,
        contentType: file.contentType,
        folderPath: file.folderPath,
        name: file.name,
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

export type CompleteUploadItem = {
  key: string;
  folderPath: string;
  name: string;
};

/** Call after client PUTs succeed so browse/search caches refresh. */
export async function completeUploadsAction(items: CompleteUploadItem[]) {
  await requireUser();
  try {
    for (const item of items) {
      const key = assertValidKey(item.key);
      const folderId = await ensureFolderPath(item.folderPath || "");
      await prisma.media.upsert({
        where: { s3Key: key },
        create: {
          s3Key: key,
          name: item.name,
          folderId,
        },
        update: {
          name: item.name,
          folderId,
          deletedAt: null,
        },
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
