/**
 * Sync the library from S3 into Postgres:
 * 1. Create Media rows for every media object missing from the DB
 *    (the media table is often incomplete — S3 is the source of truth for blobs)
 * 2. Create Folder rows for every path segment
 * 3. Set media.folder_id + unique display name per folder
 *
 * Idempotent. Does not touch EXIF / datetime_taken.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  console.log(
    `backfill-folders | ${args.dryRun ? "dry-run" : "write"}`,
  );

  try {
    console.log("Listing S3 objects…");
    const objects = await listAllObjects("", { includeMarkers: true });
    console.log(`Found ${objects.length} S3 object(s) (incl. markers)`);

    const existingByKey = new Map(
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
    let mediaCreated = 0;
    let trashMarked = 0;
    let mediaSkippedNonMedia = 0;

    // Pass 1: ensure a Media row for every media blob; collect folder paths.
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
        // Still collect parent folders so empty-ish trees from non-media stay.
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

      if (!existing) {
        if (args.dryRun) {
          mediaCreated += 1;
          console.log(
            `  create-media   ${obj.key}${inTrash ? " (trash)" : ""}`,
          );
          // Placeholder so later passes can reason about the key.
          existingByKey.set(obj.key, {
            id: `dry_${obj.key}`,
            s3Key: obj.key,
            name: desiredName,
            folderId: null,
            deletedAt: inTrash ? (obj.lastModified ?? new Date()) : null,
          });
          continue;
        }

        const created = await prisma.media.create({
          data: {
            s3Key: obj.key,
            name: desiredName,
            deletedAt: inTrash ? (obj.lastModified ?? new Date()) : null,
          },
        });
        existingByKey.set(obj.key, {
          id: created.id,
          s3Key: created.s3Key,
          name: created.name,
          folderId: created.folderId,
          deletedAt: created.deletedAt,
        });
        mediaCreated += 1;
        console.log(`  create-media   ${obj.key}${inTrash ? " (trash)" : ""}`);
        continue;
      }

      if (inTrash && !existing.deletedAt) {
        if (args.dryRun) {
          trashMarked += 1;
          console.log(`  mark-trash     ${obj.key}`);
          existing.deletedAt = obj.lastModified ?? new Date();
          continue;
        }
        await prisma.media.update({
          where: { id: existing.id },
          data: { deletedAt: obj.lastModified ?? new Date() },
        });
        existing.deletedAt = obj.lastModified ?? new Date();
        trashMarked += 1;
        console.log(`  mark-trash     ${obj.key}`);
      }
    }

    console.log(
      `Media created=${mediaCreated} trashMarked=${trashMarked} nonMediaSkipped=${mediaSkippedNonMedia}`,
    );

    // Pass 2: ensure Folder rows (shallow → deep).
    const sortedPaths = [...pathSet].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
    );

    const pathToId = new Map<string, string>();
    const existingFolders = await prisma.folder.findMany({
      select: { id: true, path: true },
    });
    for (const f of existingFolders) pathToId.set(f.path, f.id);

    console.log(`Folders to ensure: ${sortedPaths.length}`);

    let foldersCreated = 0;
    for (const path of sortedPaths) {
      if (pathToId.has(path)) continue;
      const name = baseName(path);
      const parentPath = parentFolder(path);
      const parentId = parentPath ? pathToId.get(parentPath) ?? null : null;
      if (parentPath && !parentId) {
        throw new Error(`Missing parent folder for ${path}`);
      }

      if (args.dryRun) {
        pathToId.set(path, `dry_${path}`);
        foldersCreated += 1;
        console.log(`  create-folder  ${path}`);
        continue;
      }

      const id = newId();
      await prisma.folder.create({
        data: { id, name, parentId, path },
      });
      pathToId.set(path, id);
      foldersCreated += 1;
      console.log(`  create-folder  ${path}`);
    }

    // Pass 3: assign folder_id + unique display names.
    // Re-read so we include rows created above (and any that existed before).
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

    let mediaUpdated = 0;
    let mediaSkipped = 0;
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

      if (args.dryRun) {
        mediaUpdated += 1;
        console.log(
          `  update-media   ${row.s3Key} → folder=${folderPath || "(root)"} name=${name}`,
        );
        continue;
      }

      await prisma.media.update({
        where: { id: row.id },
        data: { folderId, name },
      });
      mediaUpdated += 1;
      console.log(
        `  update-media   ${row.s3Key} → folder=${folderPath || "(root)"} name=${name}`,
      );
    }

    if (!args.dryRun) {
      // Safe now that active rows have folder_id + per-folder unique names.
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "media_root_name_active_key"
          ON "media"("name")
          WHERE "deleted_at" IS NULL AND "folder_id" IS NULL
      `);
      console.log(`Ensured unique index media_root_name_active_key`);
    }

    console.log(
      `\nDone. mediaCreated=${mediaCreated} foldersCreated=${foldersCreated} mediaUpdated=${mediaUpdated} mediaSkipped=${mediaSkipped} trashMarked=${trashMarked}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
