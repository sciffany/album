import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
};

export type MediaWithTags = Prisma.MediaGetPayload<{
  include: { tags: { include: { tag: true } } };
}>;

function parseDayStart(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function searchMedia({
  q,
  from,
  to,
}: SearchParams): Promise<MediaWithTags[]> {
  const query = q?.trim() ?? "";
  const fromDate = from ? parseDayStart(from) : null;
  const toDate = to ? parseDayEnd(to) : null;

  if (!query && !fromDate && !toDate) {
    return [];
  }

  const dateClauses: Prisma.Sql[] = [];
  if (fromDate) {
    dateClauses.push(Prisma.sql`m.date_taken >= ${fromDate}`);
  }
  if (toDate) {
    dateClauses.push(Prisma.sql`m.date_taken <= ${toDate}`);
  }

  const dateAnd =
    dateClauses.length > 0
      ? Prisma.sql`AND ${Prisma.join(dateClauses, " AND ")}`
      : Prisma.empty;

  let ids: string[];

  if (query) {
    // Caption FTS ∪ tag text match, then AND date range
    const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>`
      SELECT m.id,
        MAX(COALESCE(ts_rank(m.search_vector, plainto_tsquery('english', ${query})), 0)) AS rank
      FROM media m
      LEFT JOIN media_tags mt ON mt.media_id = m.id
      LEFT JOIN tags t ON t.id = mt.tag_id
      WHERE (
        m.search_vector @@ plainto_tsquery('english', ${query})
        OR t.text ILIKE ${"%" + query + "%"}
      )
      ${dateAnd}
      GROUP BY m.id, m.date_taken
      ORDER BY rank DESC, m.date_taken DESC NULLS LAST
      LIMIT 100
    `;
    ids = rows.map((r) => r.id);
  } else {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id
      FROM media m
      WHERE m.date_taken IS NOT NULL
      ${dateAnd}
      ORDER BY m.date_taken DESC NULLS LAST
      LIMIT 100
    `;
    ids = rows.map((r) => r.id);
  }

  if (ids.length === 0) return [];

  const media = await prisma.media.findMany({
    where: { id: { in: ids } },
    include: {
      tags: { include: { tag: true } },
    },
  });

  const byId = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as MediaWithTags[];
}
