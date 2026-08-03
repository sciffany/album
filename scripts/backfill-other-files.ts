/**
 * Index non-media S3 objects (PDFs, docs, etc.) into Postgres Media rows
 * and place them in the Folder tree. Media photos/videos are left alone —
 * use backfill-folders.ts for those.
 *
 * Idempotent: existing s3_key rows are never re-inserted.
 *
 * Usage:
 *   npx tsx scripts/backfill-other-files.ts
 *   npx tsx scripts/backfill-other-files.ts --dry-run
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { isBrowsableObjectKey, isMediaKey } from "../src/lib/media-types";
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

function newId(): string {
  return `c${crypto.randomUUID().replace(/-/g, "")}`;
}

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--help" || raw === "-h") {
      console.log(`Usage: npx tsx scripts/backfill-other-files.ts [--dry-run]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return args;
}

/** Library path used to place the file in the folder tree (never a trash key). */
function libraryPathForObject(s3Key: string): string {
  if (!isTrashKey(s3Key)) return s3Key;
  return originalKeyFromTrashKey(s3Key) ?? baseName(s3Key);
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

/** Resolve the library-facing key used for type checks (strips legacy trash). */
function typeKeyForObject(key: string): string | null {
  if (key.endsWith("/") || key === TRASH_ROOT) return null;
  if (isTrashKey(key)) return originalKeyFromTrashKey(key);
  return key;
}

/** Browsable non-media object under the library or legacy trash. */
function isLibraryOtherFileKey(key: string): boolean {
  const typeKey = typeKeyForObject(key);
  if (!typeKey) return false;
  return isBrowsableObjectKey(typeKey) && !isMediaKey(typeKey);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function claimName(used: Set<string>, desired: string): string {
  if (!used.has(desired)) {
    used.add(desired);
    return desired;
  }
  const extIdx = desired.lastIndexOf(".");
  const stem = extIdx > 0 ? desired.slice(0, extIdx) : desired;
  const ext = extIdx > 0 ? desired.slice(extIdx) : "";
  let n = 2;
  while (used.has(`${stem} (${n})${ext}`)) n += 1;
  const name = `${stem} (${n})${ext}`;
  used.add(name);
  return name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  console.log(
    `backfill-other-files | ${args.dryRun ? "dry-run" : "write"} | batch=${MEDIA_CREATE_BATCH}`,
  );

  try {
    console.log("Listing S3 objects…");
    const objects = await listAllObjects("");
    console.log(`Found ${objects.length} S3 object(s)`);

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
    const toCreate: {
      id: string;
      s3Key: string;
      name: string;
      deletedAt: Date | null;
    }[] = [];
    let alreadyPresent = 0;
    let skippedMedia = 0;
    let skippedOther = 0;

    for (const obj of objects) {
      const typeKey = typeKeyForObject(obj.key);
      if (!typeKey) {
        skippedOther += 1;
        continue;
      }
      if (isMediaKey(typeKey)) {
        skippedMedia += 1;
        continue;
      }
      if (!isBrowsableObjectKey(typeKey)) {
        skippedOther += 1;
        continue;
      }

      const libraryKey = libraryPathForObject(obj.key);
      const folderPath = parentFolder(normalizeFolderPath(libraryKey));
      for (const p of collectAncestorPaths(folderPath)) {
        pathSet.add(p);
      }

      const desiredName = baseName(libraryKey);
      const inTrash = isTrashKey(obj.key);
      const existing = existingByKey.get(obj.key);

      if (existing) {
        alreadyPresent += 1;
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
      existingByKey.set(obj.key, {
        id,
        s3Key: obj.key,
        name: desiredName,
        folderId: null,
        deletedAt,
      });
    }

    console.log(
      `Plan: create=${toCreate.length} alreadyPresent=${alreadyPresent} skippedMedia=${skippedMedia} skippedOther=${skippedOther}`,
    );

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

    // Ensure Folder rows for placement (shallow → deep).
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
    const byDepth = new Map<number, string[]>();
    for (const path of missingPaths) {
      const depth = path.split("/").length;
      const list = byDepth.get(depth) ?? [];
      list.push(path);
      byDepth.set(depth, list);
    }

    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
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

      for (const [i, batch] of chunk(rows, FOLDER_CREATE_BATCH).entries()) {
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
          `  create-folder depth=${depth} batch ${i + 1} (+${batch.length}, total ${foldersCreated})`,
        );
      }
    }

    if (!args.dryRun && missingPaths.length > 0) {
      const refreshed = await prisma.folder.findMany({
        where: { path: { in: missingPaths } },
        select: { id: true, path: true },
      });
      for (const f of refreshed) pathToId.set(f.path, f.id);
    }

    // Assign folder_id + unique display names for other-file rows.
    const otherKeys = [
      ...new Set(
        objects.map((o) => o.key).filter((key) => isLibraryOtherFileKey(key)),
      ),
    ];

    const mediaRows = args.dryRun
      ? [...existingByKey.values()].filter((row) => otherKeys.includes(row.s3Key))
      : await prisma.media.findMany({
          where: { s3Key: { in: otherKeys } },
          select: {
            id: true,
            s3Key: true,
            name: true,
            folderId: true,
            deletedAt: true,
          },
        });

    // Names already taken by active rows (photos/videos + other files).
    const usedNames = new Map<string, Set<string>>();
    function nameSet(folderId: string | null): Set<string> {
      const key = folderId ?? "";
      let set = usedNames.get(key);
      if (!set) {
        set = new Set();
        usedNames.set(key, set);
      }
      return set;
    }

    const allActive = await prisma.media.findMany({
      where: { deletedAt: null },
      select: { id: true, folderId: true, name: true },
    });
    for (const row of allActive) {
      nameSet(row.folderId).add(row.name);
    }
    // Dry-run inserts are not in the DB yet.
    if (args.dryRun) {
      for (const row of toCreate) {
        if (!row.deletedAt) nameSet(null).add(row.name);
      }
    }

    const toUpdate: { id: string; folderId: string | null; name: string }[] =
      [];
    let alreadyOk = 0;

    for (const row of mediaRows) {
      const libraryKey = libraryPathForObject(row.s3Key);
      const folderPath = parentFolder(normalizeFolderPath(libraryKey));
      const folderId = folderPath ? pathToId.get(folderPath) ?? null : null;
      const desiredName = row.name || baseName(libraryKey);

      let name = desiredName;
      if (!row.deletedAt) {
        // Free this row's current claim so it can take desiredName when free.
        nameSet(row.folderId).delete(row.name);
        name = claimName(nameSet(folderId), desiredName);
      }

      if (row.folderId === folderId && row.name === name) {
        alreadyOk += 1;
        continue;
      }
      toUpdate.push({ id: row.id, folderId, name });
    }

    console.log(
      `Media updates: toUpdate=${toUpdate.length} alreadyOk=${alreadyOk}`,
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

    console.log(
      `\nDone. mediaCreated=${mediaCreated} alreadyPresent=${alreadyPresent} foldersCreated=${foldersCreated} mediaUpdated=${mediaUpdated}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
