/**
 * Read capture time from EXIF / QuickTime metadata for DB media rows,
 * and upsert `media.datetime_taken` in Neon.
 *
 * Usage:
 *   npx tsx scripts/sync-datetime-taken.ts
 *   npx tsx scripts/sync-datetime-taken.ts --prefix=Family/2024
 *   npx tsx scripts/sync-datetime-taken.ts --force --dry-run
 *   npx tsx scripts/sync-datetime-taken.ts --limit=20 --concurrency=4
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import exifr from "exifr";
import { getObjectBytes } from "../src/lib/s3";

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

const VIDEO_EXT = new Set(["mp4", "mov", "m4v"]);

/** Bytes to fetch for stills — EXIF APP1 is almost always near the start. */
const IMAGE_RANGE_BYTES = 512 * 1024;
/** Videos need a larger head for the moov/meta atoms. */
const VIDEO_RANGE_BYTES = 2 * 1024 * 1024;

type Args = {
  prefix: string;
  force: boolean;
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    prefix: "",
    force: false,
    dryRun: false,
    limit: null,
    concurrency: 4,
  };

  for (const raw of argv) {
    if (raw === "--force") args.force = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--prefix=")) {
      args.prefix = raw.slice("--prefix=".length).replace(/^\/+|\/+$/g, "");
    } else if (raw.startsWith("--limit=")) {
      const n = Number(raw.slice("--limit=".length));
      if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid --limit: ${raw}`);
      args.limit = Math.floor(n);
    } else if (raw.startsWith("--concurrency=")) {
      const n = Number(raw.slice("--concurrency=".length));
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid --concurrency: ${raw}`);
      }
      args.concurrency = Math.min(16, Math.floor(n));
    } else if (raw === "--help" || raw === "-h") {
      console.log(`Usage: npx tsx scripts/sync-datetime-taken.ts [options]

Options:
  --prefix=<path>     Only process media whose folder path or s3 key starts with this
  --force             Overwrite existing datetime_taken values
  --dry-run           Parse EXIF but do not write to the database
  --limit=<n>         Process at most n media keys
  --concurrency=<n>   Parallel downloads (default 4, max 16)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }

  return args;
}

function extOf(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedMedia(key: string): boolean {
  const base = key.split("/").pop() ?? key;
  if (base.startsWith(".")) return false;
  const ext = extOf(key);
  return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext);
}

function isVideo(key: string): boolean {
  return VIDEO_EXT.has(extOf(key));
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

async function extractDatetimeTaken(key: string): Promise<Date | null> {
  const byteLength = isVideo(key) ? VIDEO_RANGE_BYTES : IMAGE_RANGE_BYTES;
  const buf = await getObjectBytes(key, { byteLength });

  const tags = await exifr.parse(buf, {
    pick: [
      "DateTimeOriginal",
      "CreateDate",
      "MediaCreateDate",
      "TrackCreateDate",
      "ModifyDate",
    ],
    // Still EXIF + HEIC/AVIF + QuickTime/MP4.
    tiff: true,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false,
    translateKeys: true,
    translateValues: true,
    reviveValues: true,
    sanitize: true,
    mergeOutput: true,
  });

  if (!tags || typeof tags !== "object") return null;

  const record = tags as Record<string, unknown>;
  return (
    asDate(record.DateTimeOriginal) ??
    asDate(record.CreateDate) ??
    asDate(record.MediaCreateDate) ??
    asDate(record.TrackCreateDate) ??
    asDate(record.ModifyDate)
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  console.log(
    [
      "sync-datetime-taken",
      args.prefix ? `prefix=${args.prefix}` : "prefix=(all db media)",
      args.force ? "force" : "skip-existing",
      args.dryRun ? "dry-run" : "write",
      `concurrency=${args.concurrency}`,
      args.limit != null ? `limit=${args.limit}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );

  try {
    const rows = await prisma.media.findMany({
      where: {
        deletedAt: null,
        ...(args.force ? {} : { datetimeTaken: null }),
        ...(args.prefix
          ? {
              OR: [
                { s3Key: { startsWith: args.prefix } },
                { folder: { path: { startsWith: args.prefix } } },
                { name: { startsWith: args.prefix } },
              ],
            }
          : {}),
      },
      select: { id: true, s3Key: true, name: true, datetimeTaken: true },
      orderBy: { s3Key: "asc" },
      ...(args.limit != null ? { take: args.limit } : {}),
    });

    const todo = rows.filter((row) => isSupportedMedia(row.name) || isSupportedMedia(row.s3Key));
    console.log(`Found ${todo.length} media row(s) to consider`);

    let updated = 0;
    let skippedNoExif = 0;
    let errors = 0;

    await mapPool(todo, args.concurrency, async (row) => {
      const key = row.s3Key;
      try {
        const datetimeTaken = await extractDatetimeTaken(key);
        if (!datetimeTaken) {
          skippedNoExif += 1;
          console.log(`  no-exif  ${key}`);
          return;
        }

        if (args.dryRun) {
          updated += 1;
          console.log(`  dry-run  ${key} → ${datetimeTaken.toISOString()}`);
          return;
        }

        await prisma.media.update({
          where: { id: row.id },
          data: { datetimeTaken },
        });
        updated += 1;
        console.log(`  updated  ${key} → ${datetimeTaken.toISOString()}`);
      } catch (err) {
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  error    ${key}: ${message}`);
      }
    });

    console.log(
      `\nDone. updated=${updated} no-exif=${skippedNoExif} errors=${errors}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
