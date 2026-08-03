import { isMediaKey } from "@/lib/media-types";
import { prisma } from "@/lib/prisma";
import { isTrashFolderPath } from "@/lib/storage-keys";

export type FolderItem = {
  name: string;
  path: string;
};

export type MediaListItem = {
  id: string;
  name: string;
  s3Key: string;
  folderPath: string;
  mediaType: string;
  datetimeTaken: Date | null;
  caption: string | null;
  aiCaption: string | null;
  tags: { tag: { id: string; text: string } }[];
};

export function pathFromSegments(segments: string[] | undefined): string {
  if (!segments?.length) return "";
  return segments.map(decodeURIComponent).join("/");
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

export function mediaTypeFromKey(key: string): string {
  if (!isMediaKey(key)) return "file";
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["gif"].includes(ext)) return "meme";
  return "photo";
}

export function mediaTypeFromName(name: string): string {
  return mediaTypeFromKey(name);
}

/** Returns true when the browse path exists (root always exists). */
export async function assertFolderExists(path: string): Promise<boolean> {
  if (!path) return true;
  if (isTrashFolderPath(path)) return false;
  const folder = await prisma.folder.findFirst({
    where: { path, deletedAt: null },
    select: { id: true },
  });
  return Boolean(folder);
}

export async function listFolderContents(path: string): Promise<{
  folders: FolderItem[];
  media: MediaListItem[];
}> {
  if (isTrashFolderPath(path)) {
    return { folders: [], media: [] };
  }

  let folderId: string | null = null;
  if (path) {
    const folder = await prisma.folder.findFirst({
      where: { path, deletedAt: null },
      select: { id: true },
    });
    if (!folder) {
      return { folders: [], media: [] };
    }
    folderId = folder.id;
  }

  const [childFolders, mediaRows] = await Promise.all([
    prisma.folder.findMany({
      where: { parentId: folderId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { name: true, path: true },
    }),
    prisma.media.findMany({
      where: { folderId, deletedAt: null },
      include: { tags: { include: { tag: true } } },
    }),
  ]);

  const media: MediaListItem[] = mediaRows.map((row) => ({
    id: row.id,
    name: row.name,
    s3Key: row.s3Key,
    folderPath: path,
    mediaType: mediaTypeFromName(row.name),
    datetimeTaken: row.datetimeTaken,
    caption: row.caption,
    aiCaption: row.aiCaption,
    tags: row.tags,
  }));

  media.sort((a, b) => {
    const at = a.datetimeTaken?.getTime() ?? 0;
    const bt = b.datetimeTaken?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });

  return {
    folders: childFolders.map((f) => ({ name: f.name, path: f.path })),
    media,
  };
}
