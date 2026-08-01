import { prisma } from "@/lib/prisma";

export function pathFromSegments(segments: string[] | undefined): string {
  if (!segments?.length) return "";
  return segments.map(decodeURIComponent).join("/");
}

export async function getFolderByPath(path: string) {
  if (!path) return null;
  return prisma.folder.findUnique({
    where: { path },
  });
}

export async function listFolderContents(folderId: number | null) {
  const [folders, media] = await Promise.all([
    prisma.folder.findMany({
      where: { parentId: folderId },
      orderBy: { name: "asc" },
    }),
    prisma.media.findMany({
      where: { folderId },
      orderBy: [{ dateTaken: "desc" }, { dateAdded: "desc" }],
      include: {
        tags: { include: { tag: true } },
      },
    }),
  ]);

  return { folders, media };
}

export function breadcrumbFromPath(path: string) {
  if (!path) return [] as { name: string; href: string }[];
  const parts = path.split("/");
  return parts.map((name, i) => ({
    name,
    href: `/browse/${parts
      .slice(0, i + 1)
      .map(encodeURIComponent)
      .join("/")}`,
  }));
}
