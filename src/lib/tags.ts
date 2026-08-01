import { prisma } from "@/lib/prisma";

export function slugifyTag(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
