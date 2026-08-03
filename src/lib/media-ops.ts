import { isMediaKey } from "@/lib/media-types";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";
import {
  assertValidFileName,
  assertValidFolderName,
  assertValidFolderPath,
  assertValidKey,
  baseName,
  makeOpaqueMediaKey,
  normalizeFolderPath,
  parentFolder,
  splitUploadRelativePath,
} from "@/lib/storage-keys";

function newId(): string {
  return `c${crypto.randomUUID().replace(/-/g, "")}`;
}

/** Ensure every segment of `path` exists; returns the leaf folder id (null for root). */
export async function ensureFolderPath(
  path: string,
): Promise<string | null> {
  const normalized = assertValidFolderPath(path || "");
  if (!normalized) return null;

  const segments = normalized.split("/");
  let parentId: string | null = null;
  let currentPath = "";

  for (const name of segments) {
    currentPath = currentPath ? `${currentPath}/${name}` : name;
    const existing = await prisma.folder.findFirst({
      where: { path: currentPath, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const softDeleted = await prisma.folder.findFirst({
      where: { path: currentPath, deletedAt: { not: null } },
      select: { id: true },
    });
    if (softDeleted) {
      await prisma.folder.update({
        where: { id: softDeleted.id },
        data: { deletedAt: null, name, parentId },
      });
      parentId = softDeleted.id;
      continue;
    }
    const id = newId();
    await prisma.folder.create({
      data: {
        id,
        name,
        parentId,
        path: currentPath,
      },
    });
    parentId = id;
  }

  return parentId;
}

async function requireFolderByPath(path: string) {
  const normalized = assertValidFolderPath(path, "folder path");
  if (!normalized) throw new Error("Cannot operate on the library root");
  const folder = await prisma.folder.findFirst({
    where: { path: normalized, deletedAt: null },
  });
  if (!folder) throw new Error("Folder not found");
  return folder;
}

async function assertNameAvailable(
  folderId: string | null,
  name: string,
  excludeMediaId?: string,
) {
  const clash = await prisma.media.findFirst({
    where: {
      folderId,
      name,
      deletedAt: null,
      ...(excludeMediaId ? { id: { not: excludeMediaId } } : {}),
    },
  });
  if (clash) {
    throw new Error(`A file named “${name}” already exists in this folder`);
  }
}

/** Create an empty folder as a DB row. */
export async function createFolder(
  parentPath: string,
  name: string,
): Promise<{ path: string }> {
  const parent = assertValidFolderPath(parentPath || "");
  const folderName = assertValidFolderName(name);
  const path = parent ? `${parent}/${folderName}` : folderName;
  assertValidFolderPath(path);

  const existing = await prisma.folder.findFirst({
    where: { path, deletedAt: null },
  });
  if (existing) throw new Error("A folder with that name already exists");

  const parentId = await ensureFolderPath(parent);

  // Reuse a soft-deleted row at the same path when present.
  const softDeleted = await prisma.folder.findFirst({
    where: { path, deletedAt: { not: null } },
  });
  if (softDeleted) {
    await prisma.folder.update({
      where: { id: softDeleted.id },
      data: { deletedAt: null, name: folderName, parentId },
    });
    return { path };
  }

  await prisma.folder.create({
    data: {
      id: newId(),
      name: folderName,
      parentId,
      path,
    },
  });
  return { path };
}

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_PRESIGN_BATCH = 100;

export type UploadPresignRequest = {
  relativePath: string;
  contentType: string;
  size: number;
};

export type ResolvedUpload = {
  key: string;
  contentType: string;
  size: number;
  folderPath: string;
  name: string;
};

/** Validate upload targets and return opaque keys + library placement. */
export function resolveUploadKeys(
  destinationFolder: string,
  files: UploadPresignRequest[],
): ResolvedUpload[] {
  if (!files.length) throw new Error("No files to upload");
  if (files.length > MAX_PRESIGN_BATCH) {
    throw new Error(`Upload at most ${MAX_PRESIGN_BATCH} files at a time`);
  }

  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const resolved: ResolvedUpload[] = [];

  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 0) {
      throw new Error("Invalid file size");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`);
    }

    const { folderPath, fileName } = splitUploadRelativePath(
      destinationFolder,
      file.relativePath,
    );
    if (!isMediaKey(fileName)) {
      throw new Error(`Unsupported media type: ${file.relativePath}`);
    }

    const nameKey = `${folderPath}\0${fileName}`;
    if (seenNames.has(nameKey)) {
      throw new Error(`Duplicate upload target: ${file.relativePath}`);
    }
    seenNames.add(nameKey);

    let key = makeOpaqueMediaKey(fileName);
    while (seenKeys.has(key)) key = makeOpaqueMediaKey(fileName);
    seenKeys.add(key);

    resolved.push({
      key,
      contentType: file.contentType?.trim() || "application/octet-stream",
      size: file.size,
      folderPath,
      name: fileName,
    });
  }

  return resolved;
}

/** Move a media row into a destination folder, optionally renaming. */
export async function moveMediaToFolder(
  fromKey: string,
  destinationFolder: string,
  fileName?: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(fromKey, "source key");
  const folder = assertValidFolderPath(destinationFolder || "");
  const media = await prisma.media.findUnique({ where: { s3Key: from } });
  if (!media || media.deletedAt) throw new Error("File not found");

  const name = assertValidFileName(fileName ?? media.name);
  const folderId = await ensureFolderPath(folder);
  await assertNameAvailable(folderId, name, media.id);

  await prisma.media.update({
    where: { id: media.id },
    data: { folderId, name },
  });

  return { fromKey: from, toKey: from };
}

/** Rename a media object in place (same parent folder). */
export async function renameMedia(
  fromKey: string,
  newName: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(fromKey, "source key");
  const media = await prisma.media.findUnique({ where: { s3Key: from } });
  if (!media || media.deletedAt) throw new Error("File not found");

  const name = assertValidFileName(newName);
  if (name === media.name) {
    return { fromKey: from, toKey: from };
  }

  await assertNameAvailable(media.folderId, name, media.id);
  await prisma.media.update({
    where: { id: media.id },
    data: { name },
  });
  return { fromKey: from, toKey: from };
}

/**
 * Rewrite materialized `path` for a folder and its descendants.
 * Uses a batch `$transaction([...])` (not interactive) so it works with
 * Neon's pooled DATABASE_URL / PgBouncer transaction mode.
 */
async function rewriteFolderSubtreePaths(
  from: string,
  to: string,
  rootUpdate: { id: string; name: string; parentId?: string | null },
): Promise<number> {
  const descendants = await prisma.folder.findMany({
    where: {
      OR: [{ path: from }, { path: { startsWith: `${from}/` } }],
    },
    select: { id: true, path: true },
  });

  await prisma.$transaction(
    descendants.map((row) => {
      const next =
        row.path === from ? to : `${to}${row.path.slice(from.length)}`;
      if (row.id === rootUpdate.id) {
        return prisma.folder.update({
          where: { id: row.id },
          data: {
            path: next,
            name: rootUpdate.name,
            ...(rootUpdate.parentId !== undefined
              ? { parentId: rootUpdate.parentId }
              : {}),
          },
        });
      }
      return prisma.folder.update({
        where: { id: row.id },
        data: { path: next },
      });
    }),
  );

  return descendants.length;
}

/** Rename a folder in place (same parent path). */
export async function renameFolder(
  fromPath: string,
  newName: string,
): Promise<{ fromPath: string; toPath: string; moved: number }> {
  const from = assertValidFolderPath(fromPath, "source folder");
  if (!from) throw new Error("Cannot rename the library root");

  const name = assertValidFolderName(newName);
  const parent = parentFolder(from);
  const to = parent ? `${parent}/${name}` : name;
  assertValidFolderPath(to, "destination folder");

  if (from === to) {
    return { fromPath: from, toPath: to, moved: 0 };
  }

  const folder = await requireFolderByPath(from);
  const clash = await prisma.folder.findFirst({
    where: { path: to, deletedAt: null },
  });
  if (clash) throw new Error("A folder with that name already exists");

  const moved = await rewriteFolderSubtreePaths(from, to, {
    id: folder.id,
    name,
  });

  return { fromPath: from, toPath: to, moved };
}

/**
 * Move a folder under a new parent path (keeps the folder's own name).
 * `toPath` is the full destination path including the folder name.
 */
export async function moveFolderPrefix(
  fromPrefix: string,
  toPrefix: string,
): Promise<{ moved: number }> {
  const from = assertValidFolderPath(fromPrefix, "source folder");
  const to = assertValidFolderPath(toPrefix, "destination folder");
  if (!from) throw new Error("Cannot move the library root");
  if (from === to) return { moved: 0 };
  if (to === from || to.startsWith(`${from}/`)) {
    throw new Error("Destination cannot be inside the source folder");
  }

  const folder = await requireFolderByPath(from);
  const clash = await prisma.folder.findFirst({
    where: { path: to, deletedAt: null },
  });
  if (clash) throw new Error("A folder with that name already exists");

  const newParentPath = parentFolder(to);
  const newName = baseName(to);
  assertValidFolderName(newName);
  const parentId = await ensureFolderPath(newParentPath);

  const moved = await rewriteFolderSubtreePaths(from, to, {
    id: folder.id,
    name: newName,
    parentId,
  });

  return { moved };
}

export async function softDeleteMediaObject(fromKey: string): Promise<string> {
  const key = assertValidKey(fromKey);
  const media = await prisma.media.findUnique({ where: { s3Key: key } });
  if (!media) throw new Error("File not found");
  if (media.deletedAt) throw new Error("File is already in the recycle bin");

  await prisma.media.update({
    where: { id: media.id },
    data: { deletedAt: new Date() },
  });
  return key;
}

/**
 * Soft-delete a folder and every descendant folder + media in its subtree.
 */
export async function softDeleteFolderPrefix(
  folderPath: string,
): Promise<{ deleted: number }> {
  const path = assertValidFolderPath(folderPath, "folder path");
  if (!path) throw new Error("Cannot delete the library root");

  await requireFolderByPath(path);
  const now = new Date();

  const descendantFolders = await prisma.folder.findMany({
    where: {
      deletedAt: null,
      OR: [{ path }, { path: { startsWith: `${path}/` } }],
    },
    select: { id: true },
  });
  const folderIds = descendantFolders.map((f) => f.id);

  const mediaCount = await prisma.media.count({
    where: { folderId: { in: folderIds }, deletedAt: null },
  });

  await prisma.$transaction([
    prisma.media.updateMany({
      where: { folderId: { in: folderIds }, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.folder.updateMany({
      where: { id: { in: folderIds }, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);

  return { deleted: mediaCount + folderIds.length };
}

export async function restoreMediaObject(
  s3Key: string,
  destinationFolder?: string,
): Promise<{ fromKey: string; toKey: string }> {
  const key = assertValidKey(s3Key, "media key");
  const media = await prisma.media.findUnique({
    where: { s3Key: key },
    include: { folder: true },
  });
  if (!media || !media.deletedAt) {
    throw new Error("File is not in the recycle bin");
  }

  let folderId = media.folderId;
  if (destinationFolder !== undefined) {
    folderId = await ensureFolderPath(
      assertValidFolderPath(destinationFolder || ""),
    );
  } else if (media.folderId && (!media.folder || media.folder.deletedAt)) {
    folderId = null;
  }

  await assertNameAvailable(folderId, media.name, media.id);

  await prisma.media.update({
    where: { id: media.id },
    data: { deletedAt: null, folderId },
  });

  return { fromKey: key, toKey: key };
}

export async function purgeMediaObject(s3Key: string): Promise<void> {
  const key = assertValidKey(s3Key, "media key");
  const media = await prisma.media.findUnique({ where: { s3Key: key } });
  if (!media || !media.deletedAt) {
    throw new Error("Only recycle bin items can be permanently deleted");
  }

  await deleteObject(key);
  await prisma.media.delete({ where: { id: media.id } });
}

export type TrashListItem = {
  s3Key: string;
  name: string;
  folderPath: string | null;
  deletedAt: Date | null;
  caption: string | null;
  aiCaption: string | null;
};

/** List soft-deleted media from the database. */
export async function listTrashMedia(): Promise<TrashListItem[]> {
  const rows = await prisma.media.findMany({
    where: { deletedAt: { not: null } },
    include: { folder: true },
    orderBy: { deletedAt: "desc" },
  });

  return rows.map((row) => ({
    s3Key: row.s3Key,
    name: row.name,
    folderPath: row.folder && !row.folder.deletedAt ? row.folder.path : null,
    deletedAt: row.deletedAt,
    caption: row.caption,
    aiCaption: row.aiCaption,
  }));
}

/** List immediate child folder paths under a path (for move destination picker). */
export async function listChildFolderPaths(path: string): Promise<string[]> {
  const normalized = normalizeFolderPath(path);

  if (!normalized) {
    const roots = await prisma.folder.findMany({
      where: { parentId: null, deletedAt: null },
      orderBy: { name: "asc" },
      select: { path: true },
    });
    return roots.map((f) => f.path);
  }

  const parent = await prisma.folder.findFirst({
    where: { path: normalized, deletedAt: null },
  });
  if (!parent) return [];

  const children = await prisma.folder.findMany({
    where: { parentId: parent.id, deletedAt: null },
    orderBy: { name: "asc" },
    select: { path: true },
  });
  return children.map((f) => f.path);
}
