import { mediaTypeFromName, type MediaListItem } from "@/lib/folders";
import { prisma } from "@/lib/prisma";
import { slugifyTag } from "@/lib/tag-slug";

export { slugifyTag };

export type TagWithMedia = {
  id: string;
  text: string;
  slug: string;
  media: MediaListItem[];
};

export async function getTagBySlug(slug: string) {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return null;
  return prisma.tag.findUnique({
    where: { slug: trimmed },
    select: { id: true, text: true, slug: true },
  });
}

export async function listMediaByTagSlug(
  slug: string,
): Promise<TagWithMedia | null> {
  const tag = await getTagBySlug(slug);
  if (!tag) return null;

  const mediaRows = await prisma.media.findMany({
    where: {
      deletedAt: null,
      tags: { some: { tagId: tag.id } },
    },
    include: {
      tags: { include: { tag: true } },
      folder: true,
    },
  });

  const media: MediaListItem[] = mediaRows.map((row) => ({
    id: row.id,
    name: row.name,
    s3Key: row.s3Key,
    folderPath: row.folder?.path ?? "",
    mediaType: mediaTypeFromName(row.name),
    datetimeTaken: row.datetimeTaken,
    caption: row.caption,
    aiCaption: row.aiCaption,
    tags: row.tags,
  }));

  media.sort((a, b) => {
    const at = a.datetimeTaken?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.datetimeTaken?.getTime() ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name);
  });

  return { ...tag, media };
}

export async function findOrCreateTags(tagTexts: string[]) {
  const bySlug = new Map<string, { text: string; slug: string }>();
  for (const raw of tagTexts) {
    const text = raw.trim();
    if (!text) continue;
    const slug = slugifyTag(text);
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, { text, slug });
  }
  const unique = [...bySlug.values()];

  const tags = await Promise.all(
    unique.map(async ({ text, slug }) => {
      return prisma.tag.upsert({
        where: { slug },
        create: { text, slug },
        update: {},
      });
    }),
  );

  return tags;
}

export async function searchTagSuggestions(query: string, limit = 10) {
  const q = query.trim();
  if (!q) {
    return prisma.tag.findMany({
      orderBy: { text: "asc" },
      take: limit,
    });
  }

  return prisma.tag.findMany({
    where: {
      text: { contains: q, mode: "insensitive" },
    },
    orderBy: { text: "asc" },
    take: limit,
  });
}
