import { isMediaKey } from "@/lib/media-types";
import { prisma } from "@/lib/prisma";
import {
  copyObject,
  deleteObject,
  listAllObjects,
  listPrefix,
  objectExists,
  putObject,
} from "@/lib/s3";
import {
  assertValidFolderName,
  assertValidFolderPath,
  assertValidKey,
  baseName,
  folderMarkerKey,
  isTrashKey,
  joinKey,
  joinRelativeKey,
  makeTrashKey,
  normalizeFolderPath,
  originalKeyFromTrashKey,
  parentFolder,
  TRASH_ROOT,
} from "@/lib/storage-keys";

async function relocateObject(fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  if (await objectExists(toKey)) {
    throw new Error(`Destination already exists: ${toKey}`);
  }

  await copyObject(fromKey, toKey);

  // Folder markers are not media rows — skip DB rewrite.
  if (!fromKey.endsWith("/") && !toKey.endsWith("/")) {
    try {
      const existing = await prisma.media.findUnique({
        where: { s3Key: fromKey },
      });
      if (existing) {
        await prisma.media.update({
          where: { id: existing.id },
          data: { s3Key: toKey },
        });
      }
    } catch (err) {
      await deleteObject(toKey).catch(() => undefined);
      throw err;
    }
  }

  await deleteObject(fromKey);
}

/** Create an empty folder via a zero-byte `path/` marker object. */
export async function createFolder(
  parentPath: string,
  name: string,
): Promise<{ path: string }> {
  const parent = assertValidFolderPath(parentPath || "");
  const folderName = assertValidFolderName(name);
  const path = parent ? `${parent}/${folderName}` : folderName;
  assertValidFolderPath(path);

  if (await prefixExistsOrMarker(path)) {
    throw new Error("A folder with that name already exists");
  }

  await putObject(folderMarkerKey(path));
  return { path };
}

async function prefixExistsOrMarker(path: string): Promise<boolean> {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return true;
  if (await objectExists(folderMarkerKey(normalized))) return true;
  const { folders, objects } = await listPrefix(normalized);
  if (folders.length > 0 || objects.length > 0) return true;
  const parentListing = await listPrefix(
    normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : "",
  );
  const name = normalized.split("/").pop()!;
  return parentListing.folders.some((f) => f.name === name);
}

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_PRESIGN_BATCH = 100;

export type UploadPresignRequest = {
  relativePath: string;
  contentType: string;
  size: number;
};

export type UploadPresignResult = {
  key: string;
  url: string;
  contentType: string;
};

/** Validate upload targets and return destination keys (presign happens in actions). */
export function resolveUploadKeys(
  destinationFolder: string,
  files: UploadPresignRequest[],
): { key: string; contentType: string; size: number }[] {
  if (!files.length) throw new Error("No files to upload");
  if (files.length > MAX_PRESIGN_BATCH) {
    throw new Error(`Upload at most ${MAX_PRESIGN_BATCH} files at a time`);
  }

  const folder = assertValidFolderPath(destinationFolder || "");
  const seen = new Set<string>();
  const resolved: { key: string; contentType: string; size: number }[] = [];

  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 0) {
      throw new Error("Invalid file size");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`);
    }

    const key = joinRelativeKey(folder, file.relativePath);
    if (isTrashKey(key)) {
      throw new Error("Cannot upload into the recycle bin");
    }
    if (!isMediaKey(key)) {
      throw new Error(`Unsupported media type: ${file.relativePath}`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate upload target: ${key}`);
    }
    seen.add(key);

    const contentType =
      file.contentType?.trim() || "application/octet-stream";
    resolved.push({ key, contentType, size: file.size });
  }

  return resolved;
}

async function recordSoftDeleteMetadata(
  fromKey: string,
  trashKey: string,
): Promise<void> {
  const existing = await prisma.media.findUnique({ where: { s3Key: fromKey } });
  if (existing) {
    await prisma.media.update({
      where: { id: existing.id },
      data: {
        s3Key: trashKey,
        deletedAt: new Date(),
        originalS3Key: existing.originalS3Key ?? fromKey,
      },
    });
    return;
  }

  await prisma.media.upsert({
    where: { s3Key: trashKey },
    create: {
      s3Key: trashKey,
      deletedAt: new Date(),
      originalS3Key: fromKey,
    },
    update: {
      deletedAt: new Date(),
      originalS3Key: fromKey,
    },
  });
}

async function softDeleteObject(fromKey: string): Promise<string> {
  const key = assertValidKey(fromKey);
  if (isTrashKey(key)) {
    throw new Error("File is already in the recycle bin");
  }

  const trashKey = makeTrashKey(key);
  if (await objectExists(trashKey)) {
    throw new Error("Could not create a unique trash key; try again");
  }

  // S3 move is authoritative. Metadata update is best-effort so a DB/schema
  // mismatch cannot roll back the trash copy (which made deletes look like no-ops).
  await copyObject(key, trashKey);

  try {
    await recordSoftDeleteMetadata(key, trashKey);
  } catch (err) {
    console.error(
      `[soft-delete] metadata update failed for ${key} → ${trashKey}`,
      err,
    );
  }

  await deleteObject(key);
  return trashKey;
}

/** Move a single media object to a new key (same or different folder). */
export async function moveMediaObject(
  fromKey: string,
  toKey: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(fromKey, "source key");
  const to = assertValidKey(toKey, "destination key");

  if (isTrashKey(from) || isTrashKey(to)) {
    throw new Error("Use restore/purge for recycle bin items");
  }
  if (from === to) {
    return { fromKey: from, toKey: to };
  }

  await relocateObject(from, to);
  return { fromKey: from, toKey: to };
}

/** Move a media object into a destination folder, optionally renaming. */
export async function moveMediaToFolder(
  fromKey: string,
  destinationFolder: string,
  fileName?: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(fromKey, "source key");
  const folder = assertValidFolderPath(destinationFolder || "");
  const name = (fileName ?? from.split("/").pop() ?? from).trim();
  const to = joinKey(folder, name);
  return moveMediaObject(from, to);
}

/** Rename a media object in place (same parent folder). */
export async function renameMedia(
  fromKey: string,
  newName: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(fromKey, "source key");
  if (baseName(from) === newName.trim()) {
    return { fromKey: from, toKey: from };
  }
  return moveMediaToFolder(from, parentFolder(from), newName);
}

/** Rename a folder in place (same parent path). */
export async function renameFolder(
  fromPath: string,
  newName: string,
): Promise<{ fromPath: string; toPath: string; moved: number }> {
  const from = assertValidFolderPath(fromPath, "source folder");
  if (!from) throw new Error("Cannot rename the bucket root");

  const name = assertValidFolderName(newName);
  const parent = parentFolder(from);
  const to = parent ? `${parent}/${name}` : name;
  assertValidFolderPath(to, "destination folder");

  if (from === to) {
    return { fromPath: from, toPath: to, moved: 0 };
  }
  if (await prefixExistsOrMarker(to)) {
    throw new Error("A folder with that name already exists");
  }

  const result = await moveFolderPrefix(from, to);
  return { fromPath: from, toPath: to, ...result };
}

/**
 * Move every object under `fromPrefix` to `toPrefix`, rewriting keys.
 * Example: Family/2024 → Archive/2024
 * Includes empty-folder marker objects (`prefix/`).
 */
export async function moveFolderPrefix(
  fromPrefix: string,
  toPrefix: string,
): Promise<{ moved: number }> {
  const from = assertValidFolderPath(fromPrefix, "source folder");
  const to = assertValidFolderPath(toPrefix, "destination folder");
  if (!from) throw new Error("Cannot move the bucket root");
  if (from === to) return { moved: 0 };
  if (to === from || to.startsWith(`${from}/`)) {
    throw new Error("Destination cannot be inside the source folder");
  }

  const objects = await listAllObjects(from, { includeMarkers: true });
  if (objects.length === 0) {
    throw new Error("Source folder is empty or does not exist");
  }

  let moved = 0;
  for (const obj of objects) {
    if (!obj.key.startsWith(`${from}/`) && obj.key !== from) continue;
    const suffix =
      obj.key === from ? "" : obj.key.slice(from.length + 1);
    // Preserve trailing slash on folder markers.
    const destKey = obj.key.endsWith("/")
      ? suffix
        ? `${to}/${suffix}`
        : `${to}/`
      : suffix
        ? `${to}/${suffix}`
        : to;
    await relocateObject(obj.key, destKey);
    moved += 1;
  }

  return { moved };
}

export async function softDeleteMediaObject(fromKey: string): Promise<string> {
  return softDeleteObject(fromKey);
}

/**
 * Soft-delete every object under a folder prefix into the recycle bin.
 * Empty-folder markers are removed (nothing meaningful to restore).
 */
export async function softDeleteFolderPrefix(
  folderPath: string,
): Promise<{ deleted: number }> {
  const path = assertValidFolderPath(folderPath, "folder path");
  if (!path) throw new Error("Cannot delete the bucket root");

  const objects = await listAllObjects(path, { includeMarkers: true });
  if (objects.length === 0) {
    throw new Error("Folder is empty or does not exist");
  }

  let deleted = 0;
  for (const obj of objects) {
    if (isTrashKey(obj.key)) continue;
    if (obj.key.endsWith("/")) {
      await deleteObject(obj.key);
      deleted += 1;
      continue;
    }
    await softDeleteObject(obj.key);
    deleted += 1;
  }
  return { deleted };
}

export async function restoreMediaObject(
  trashKey: string,
  destinationKey?: string,
): Promise<{ fromKey: string; toKey: string }> {
  const from = assertValidKey(trashKey, "trash key");
  if (!isTrashKey(from)) {
    throw new Error("File is not in the recycle bin");
  }

  const row = await prisma.media.findUnique({ where: { s3Key: from } });
  const inferred = originalKeyFromTrashKey(from);
  const restoreTo = assertValidKey(
    destinationKey?.trim() || row?.originalS3Key || inferred || "",
    "restore destination",
  );

  if (isTrashKey(restoreTo)) {
    throw new Error("Cannot restore into the recycle bin");
  }

  await relocateObject(from, restoreTo);

  // relocateObject rewrites s3_key when a trash-key row exists; also clear
  // soft-delete fields on a row that still points at the restore destination
  // (metadata update may have failed during soft-delete).
  await prisma.media.updateMany({
    where: { s3Key: restoreTo },
    data: { deletedAt: null, originalS3Key: null },
  });

  return { fromKey: from, toKey: restoreTo };
}

export async function purgeMediaObject(trashKey: string): Promise<void> {
  const key = assertValidKey(trashKey, "trash key");
  if (!isTrashKey(key)) {
    throw new Error("Only recycle bin items can be permanently deleted");
  }

  await deleteObject(key);
  await prisma.media.deleteMany({ where: { s3Key: key } });
}

export type TrashListItem = {
  s3Key: string;
  originalS3Key: string | null;
  deletedAt: Date | null;
  caption: string | null;
  aiCaption: string | null;
};

/** List recycle-bin objects from S3 (`_trash/`), joined with optional DB metadata. */
export async function listTrashMedia(): Promise<TrashListItem[]> {
  const objects = await listAllObjects(TRASH_ROOT);
  if (objects.length === 0) return [];

  const keys = objects.map((o) => o.key);
  const rows = await prisma.media.findMany({
    where: {
      OR: [{ s3Key: { in: keys } }, { deletedAt: { not: null } }],
    },
  });
  const byKey = new Map(rows.map((r) => [r.s3Key, r]));

  return objects
    .map((obj) => {
      const row = byKey.get(obj.key);
      return {
        s3Key: obj.key,
        originalS3Key:
          row?.originalS3Key ?? originalKeyFromTrashKey(obj.key),
        deletedAt: row?.deletedAt ?? obj.lastModified,
        caption: row?.caption ?? null,
        aiCaption: row?.aiCaption ?? null,
      };
    })
    .sort((a, b) => {
      const at = a.deletedAt?.getTime() ?? 0;
      const bt = b.deletedAt?.getTime() ?? 0;
      if (at !== bt) return bt - at;
      return a.s3Key.localeCompare(b.s3Key);
    });
}

/** List immediate child folder paths under a path (for move destination picker). */
export async function listChildFolderPaths(path: string): Promise<string[]> {
  const normalized = normalizeFolderPath(path);
  if (normalized && isTrashKey(normalized)) return [];

  const { folders } = await listPrefix(normalized);
  return folders
    .filter((f) => !(normalized === "" && f.name === TRASH_ROOT))
    .map((f) => f.path);
}
