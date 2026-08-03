/**
 * Read capture time from EXIF / QuickTime metadata for DB media rows,
 * and upsert `media.datetime_taken` in Neon.
 *
 * Safe with DB-owned folders: only writes `datetime_taken`. Never touches
 * folder rows, `folder_id`, `name`, or `s3_key`.
 *
 * Usage:
 *   npx tsx scripts/sync-datetime-taken.ts
 *   npx tsx scripts/sync-datetime-taken.ts --prefix=Family/2024
 *   npx tsx scripts/sync-datetime-taken.ts --force --dry-run
 *   npx tsx scripts/sync-datetime-taken.ts --limit=20 --concurrency=4
 */
import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";
import {
  extractDatetimeTaken,
  isSupportedDatetimeMedia,
} from "../src/lib/datetime-taken";

/** Rows per bulk UPDATE. Keep modest so progress logs show up often. */
const UPDATE_BATCH = 100;

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

/** One-statement bulk update — avoids Neon hanging on huge Prisma $transaction lists. */
async function bulkUpdateDatetimeTaken(
  prisma: PrismaClient,
  rows: { id: string; datetimeTaken: Date }[],
): Promise<void> {
  if (rows.length === 0) return;

  const values = Prisma.join(
    rows.map((row) => Prisma.sql`(${row.id}, ${row.datetimeTaken})`),
  );

  await prisma.$executeRaw`
    UPDATE "media" AS m
    SET "datetime_taken" = v.datetime_taken::timestamptz
    FROM (VALUES ${values}) AS v(id, datetime_taken)
    WHERE m."id" = v.id
  `;
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

    const todo = rows.filter(
      (row) =>
        isSupportedDatetimeMedia(row.name) ||
        isSupportedDatetimeMedia(row.s3Key),
    );
    console.log(`Found ${todo.length} media row(s) to consider`);

    let skippedNoExif = 0;
    let errors = 0;
    let updated = 0;
    let batchNum = 0;
    const pending: { id: string; datetimeTaken: Date }[] = [];

    // Serialize flushes; EXIF workers only enqueue — they do not await DB writes.
    let flushChain: Promise<void> = Promise.resolve();

    const enqueueFlush = (force = false) => {
      flushChain = flushChain
        .then(async () => {
          while (
            pending.length >= UPDATE_BATCH ||
            (force && pending.length > 0)
          ) {
            const batch = pending.splice(0, UPDATE_BATCH);
            batchNum += 1;
            console.log(
              `  update-media  batch ${batchNum} writing ${batch.length}…` +
                (args.dryRun ? " (dry-run)" : ""),
            );
            if (!args.dryRun) {
              await bulkUpdateDatetimeTaken(prisma, batch);
            }
            updated += batch.length;
            console.log(
              `  update-media  batch ${batchNum} done (+${batch.length}, total ${updated})`,
            );
          }
        })
        .catch((err) => {
          errors += 1;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  error    bulk-update: ${message}`);
        });
    };

    await mapPool(todo, args.concurrency, async (row) => {
      const key = row.s3Key;
      try {
        const datetimeTaken = await extractDatetimeTaken(key);
        if (!datetimeTaken) {
          skippedNoExif += 1;
          console.log(`  no-exif  ${key}`);
          return;
        }
        pending.push({ id: row.id, datetimeTaken });
        console.log(`  parsed   ${key} → ${datetimeTaken.toISOString()}`);
        if (pending.length >= UPDATE_BATCH) {
          enqueueFlush();
        }
      } catch (err) {
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  error    ${key}: ${message}`);
      }
    });

    enqueueFlush(true);
    await flushChain;

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
