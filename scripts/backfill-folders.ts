/**
 * Sync the library from S3 into Postgres:
 * 1. Create Media rows for every media object missing from the DB (batched)
 * 2. Create Folder rows for every path segment (batched per depth)
 * 3. Set media.folder_id + unique display name per folder (batched)
 *
 * Idempotent: existing s3_key rows are never re-inserted.
 * Does not touch EXIF / datetime_taken.
 *
 * Usage:
 *   npx tsx scripts/backfill-folders.ts
 *   npx tsx scripts/backfill-folders.ts --dry-run
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { isMediaKey } from "../src/lib/media-types";
import { listAllObjects } from "../src/lib/s3";
import {
  baseName,
  isTrashKey,
  normalizeFolderPath,
  originalKeyFromTrashKey,
  parentFolder,
  TRASH_ROOT,
} from "../src/lib/storage-keys";

const MEDIA_CREATE_BATCH = 500;
const FOLDER_CREATE_BATCH = 500;
const MEDIA_UPDATE_BATCH = 500;
const TRASH_MARK_BATCH = 500;

function newId(): string {
  return `c${crypto.randomUUID().replace(/-/g, "")}`;
}

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--help" || raw === "-h") {
      console.log(`Usage: npx tsx scripts/backfill-folders.ts [--dry-run]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return args;
}

/** Library path used to place the file in the folder tree (never a trash key). */
function libraryPathForMedia(s3Key: string): string {
  if (!isTrashKey(s3Key)) return s3Key;
  return originalKeyFromTrashKey(s3Key) ?? baseName(s3Key);
}

function folderPathFromLibraryKey(libraryKey: string): string {
  return parentFolder(normalizeFolderPath(libraryKey));
}

function collectAncestorPaths(folderPath: string): string[] {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return [];
  const parts = normalized.split("/");
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    paths.push(parts.slice(0, i + 1).join("/"));
  }
  return paths;
}

/** True when the object key is a media file under the library or trash. */
function isLibraryMediaKey(key: string): boolean {
  if (key.endsWith("/")) return false;
  if (key === TRASH_ROOT) return false;
  if (isTrashKey(key)) {
    const original = originalKeyFromTrashKey(key);
    return original ? isMediaKey(original) : isMediaKey(key);
  }
  return isMediaKey(key);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type MediaRow = {
  id: string;
  s3Key: string;
  name: string;
  folderId: string | null;
  deletedAt: Date | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  console.log(
    `backfill-folders | ${args.dryRun ? "dry-run" : "write"} | batch=${MEDIA_CREATE_BATCH}`,
  );

  try {
    console.log("Listing S3 objects…");
    const objects = await listAllObjects("", { includeMarkers: true });
    console.log(`Found ${objects.length} S3 object(s) (incl. markers)`);

    const existingByKey = new Map<string, MediaRow>(
      (
        await prisma.media.findMany({
          select: {
            id: true,
            s3Key: true,
            name: true,
            folderId: true,
            deletedAt: true,
          },
        })
      ).map((row) => [row.s3Key, row]),
    );
    console.log(`Existing media rows: ${existingByKey.size}`);

    const pathSet = new Set<string>();
    const toCreate: {
      id: string;
      s3Key: string;
      name: string;
      deletedAt: Date | null;
    }[] = [];
    const toMarkTrashIds: string[] = [];
    let alreadyPresent = 0;
    let mediaSkippedNonMedia = 0;

    // Pass 1a: classify S3 objects — skip existing s3_key, queue missing creates.
    for (const obj of objects) {
      if (obj.key === TRASH_ROOT) continue;

      if (obj.key.endsWith("/")) {
        if (isTrashKey(obj.key)) continue;
        const folderPath = normalizeFolderPath(obj.key.slice(0, -1));
        for (const p of collectAncestorPaths(folderPath)) {
          pathSet.add(p);
        }
        continue;
      }

      if (!isLibraryMediaKey(obj.key)) {
        mediaSkippedNonMedia += 1;
        if (!isTrashKey(obj.key)) {
          for (const p of collectAncestorPaths(parentFolder(obj.key))) {
            pathSet.add(p);
          }
        }
        continue;
      }

      const libraryKey = libraryPathForMedia(obj.key);
      const folderPath = folderPathFromLibraryKey(libraryKey);
      for (const p of collectAncestorPaths(folderPath)) {
        pathSet.add(p);
      }

      const desiredName = baseName(libraryKey);
      const inTrash = isTrashKey(obj.key);
      const existing = existingByKey.get(obj.key);

      if (existing) {
        alreadyPresent += 1;
        if (inTrash && !existing.deletedAt) {
          toMarkTrashIds.push(existing.id);
          existing.deletedAt = obj.lastModified ?? new Date();
        }
        continue;
      }

      const id = newId();
      const deletedAt = inTrash ? (obj.lastModified ?? new Date()) : null;
      toCreate.push({
        id,
        s3Key: obj.key,
        name: desiredName,
        deletedAt,
      });
      // Track locally so later passes see new rows without re-query mid-loop.
      existingByKey.set(obj.key, {
        id,
        s3Key: obj.key,
        name: desiredName,
        folderId: null,
        deletedAt,
      });
    }

    console.log(
      `Plan: create=${toCreate.length} alreadyPresent=${alreadyPresent} markTrash=${toMarkTrashIds.length} nonMedia=${mediaSkippedNonMedia}`,
    );

    // Pass 1b: batch-create missing media (skipDuplicates on unique s3_key).
    let mediaCreated = 0;
    if (toCreate.length > 0) {
      const batches = chunk(toCreate, MEDIA_CREATE_BATCH);
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i]!;
        if (!args.dryRun) {
          const result = await prisma.media.createMany({
            data: batch,
            skipDuplicates: true,
          });
          mediaCreated += result.count;
        } else {
          mediaCreated += batch.length;
        }
        console.log(
          `  create-media  batch ${i + 1}/${batches.length} (+${batch.length}, total ${mediaCreated}/${toCreate.length})`,
        );
      }
    } else {
      console.log("  create-media  nothing to insert");
    }

    // Pass 1c: batch-mark legacy trash keys as soft-deleted.
    let trashMarked = 0;
    if (toMarkTrashIds.length > 0) {
      const batches = chunk(toMarkTrashIds, TRASH_MARK_BATCH);
      const now = new Date();
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i]!;
        if (!args.dryRun) {
          const result = await prisma.media.updateMany({
            where: { id: { in: batch }, deletedAt: null },
            data: { deletedAt: now },
          });
          trashMarked += result.count;
        } else {
          trashMarked += batch.length;
        }
        console.log(
          `  mark-trash    batch ${i + 1}/${batches.length} (+${batch.length}, total ${trashMarked}/${toMarkTrashIds.length})`,
        );
      }
    }

    // Pass 2: ensure Folder rows (shallow → deep), batched per depth.
    const sortedPaths = [...pathSet].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
    );

    const pathToId = new Map<string, string>();
    const existingFolders = await prisma.folder.findMany({
      select: { id: true, path: true },
    });
    for (const f of existingFolders) pathToId.set(f.path, f.id);

    const missingPaths = sortedPaths.filter((p) => !pathToId.has(p));
    console.log(
      `Folders: existing=${pathToId.size} toCreate=${missingPaths.length}`,
    );

    let foldersCreated = 0;
    // Group by depth so parents exist before children.
    const byDepth = new Map<number, string[]>();
    for (const path of missingPaths) {
      const depth = path.split("/").length;
      const list = byDepth.get(depth) ?? [];
      list.push(path);
      byDepth.set(depth, list);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);

    for (const depth of depths) {
      const pathsAtDepth = byDepth.get(depth) ?? [];
      const rows = pathsAtDepth.map((path) => {
        const id = newId();
        pathToId.set(path, id);
        const parentPath = parentFolder(path);
        const parentId = parentPath ? pathToId.get(parentPath) ?? null : null;
        if (parentPath && !parentId) {
          throw new Error(`Missing parent folder for ${path}`);
        }
        return {
          id,
          name: baseName(path),
          parentId,
          path,
        };
      });

      const batches = chunk(rows, FOLDER_CREATE_BATCH);
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i]!;
        if (!args.dryRun) {
          const result = await prisma.folder.createMany({
            data: batch,
            skipDuplicates: true,
          });
          foldersCreated += result.count;
        } else {
          foldersCreated += batch.length;
        }
        console.log(
          `  create-folder depth=${depth} batch ${i + 1}/${batches.length} (+${batch.length}, total ${foldersCreated})`,
        );
      }
    }

    // If createMany skipped duplicates, refresh path→id from DB.
    if (!args.dryRun && missingPaths.length > 0) {
      const refreshed = await prisma.folder.findMany({
        where: { path: { in: missingPaths } },
        select: { id: true, path: true },
      });
      for (const f of refreshed) pathToId.set(f.path, f.id);
    }

    // Pass 3: assign folder_id + unique display names (batched updates).
    const mediaRows = args.dryRun
      ? [...existingByKey.values()]
      : await prisma.media.findMany({
          select: {
            id: true,
            s3Key: true,
            name: true,
            folderId: true,
            deletedAt: true,
          },
        });

    const usedNames = new Map<string, Set<string>>();

    function getNameSet(folderId: string | null): Set<string> {
      const key = folderId ?? "";
      let set = usedNames.get(key);
      if (!set) {
        set = new Set();
        usedNames.set(key, set);
      }
      return set;
    }

    function claimName(folderId: string | null, desired: string): string {
      const set = getNameSet(folderId);
      if (!set.has(desired)) {
        set.add(desired);
        return desired;
      }
      const extIdx = desired.lastIndexOf(".");
      const stem = extIdx > 0 ? desired.slice(0, extIdx) : desired;
      const ext = extIdx > 0 ? desired.slice(extIdx) : "";
      let n = 2;
      while (set.has(`${stem} (${n})${ext}`)) n += 1;
      const name = `${stem} (${n})${ext}`;
      set.add(name);
      return name;
    }

    const toUpdate: { id: string; folderId: string | null; name: string }[] =
      [];
    let mediaSkipped = 0;

    for (const row of mediaRows) {
      const libraryKey = libraryPathForMedia(row.s3Key);
      const folderPath = folderPathFromLibraryKey(libraryKey);
      const folderId = folderPath ? pathToId.get(folderPath) ?? null : null;
      const desiredName = row.name || baseName(libraryKey);

      const name = row.deletedAt
        ? desiredName
        : claimName(folderId, desiredName);

      if (row.folderId === folderId && row.name === name) {
        mediaSkipped += 1;
        continue;
      }
      toUpdate.push({ id: row.id, folderId, name });
    }

    console.log(
      `Media updates: toUpdate=${toUpdate.length} alreadyOk=${mediaSkipped}`,
    );

    let mediaUpdated = 0;
    const updateBatches = chunk(toUpdate, MEDIA_UPDATE_BATCH);
    for (let i = 0; i < updateBatches.length; i += 1) {
      const batch = updateBatches[i]!;
      if (!args.dryRun) {
        await prisma.$transaction(
          batch.map((row) =>
            prisma.media.update({
              where: { id: row.id },
              data: { folderId: row.folderId, name: row.name },
            }),
          ),
        );
      }
      mediaUpdated += batch.length;
      console.log(
        `  update-media  batch ${i + 1}/${updateBatches.length} (+${batch.length}, total ${mediaUpdated}/${toUpdate.length})`,
      );
    }

    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "media_root_name_active_key"
          ON "media"("name")
          WHERE "deleted_at" IS NULL AND "folder_id" IS NULL
      `);
      console.log(`Ensured unique index media_root_name_active_key`);
    }

    console.log(
      `\nDone. mediaCreated=${mediaCreated} alreadyPresent=${alreadyPresent} foldersCreated=${foldersCreated} mediaUpdated=${mediaUpdated} mediaSkipped=${mediaSkipped} trashMarked=${trashMarked}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
