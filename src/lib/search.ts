import { prisma } from "@/lib/prisma";
import { mediaTypeFromKey, type MediaListItem } from "@/lib/folders";

export type SearchParams = {
  q?: string;
};

export async function searchMedia({
  q,
}: SearchParams): Promise<MediaListItem[]> {
  const query = q?.trim() ?? "";
  if (!query) return [];

  const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>`
    SELECT m.id,
      MAX(COALESCE(ts_rank(m.search_vector, plainto_tsquery('english', ${query})), 0)) AS rank
    FROM media m
    LEFT JOIN media_tags mt ON mt.media_id = m.id
    LEFT JOIN tags t ON t.id = mt.tag_id
    WHERE m.deleted_at IS NULL
      AND (
        m.search_vector @@ plainto_tsquery('english', ${query})
        OR t.text ILIKE ${"%" + query + "%"}
        OR m.s3_key ILIKE ${"%" + query + "%"}
      )
    GROUP BY m.id
    ORDER BY rank DESC
    LIMIT 100
  `;

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const media = await prisma.media.findMany({
    where: { id: { in: ids } },
    include: {
      tags: { include: { tag: true } },
    },
  });

  const byId = new Map(media.map((m) => [m.id, m]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      s3Key: row!.s3Key,
      mediaType: mediaTypeFromKey(row!.s3Key),
      datetimeTaken: row!.datetimeTaken,
      caption: row!.caption,
      aiCaption: row!.aiCaption,
      tags: row!.tags,
    }));
}
