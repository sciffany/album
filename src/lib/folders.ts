import { isMediaKey } from "@/lib/media-types";
import { prisma } from "@/lib/prisma";
import {
  assertValidFolderPath,
  isTrashFolderPath,
} from "@/lib/storage-keys";

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

export type FolderDownloadEntry = {
  /** Path inside the zip, relative to the archive root (includes folder leaf name). */
  zipPath: string;
  s3Key: string;
};

/**
 * Resolve every active media file under a folder (recursive) for zip download.
 * Zip paths are rooted at the folder's leaf name, e.g. `Vacation/day1/a.jpg`.
 */
export async function listFolderDownloadEntries(
  folderPath: string,
): Promise<{ folderName: string; entries: FolderDownloadEntry[] }> {
  const path = assertValidFolderPath(folderPath || "", "folder path");
  if (!path || isTrashFolderPath(path)) {
    throw new Error("Folder not found");
  }

  const folder = await prisma.folder.findFirst({
    where: { path, deletedAt: null },
    select: { id: true, name: true, path: true },
  });
  if (!folder) {
    throw new Error("Folder not found");
  }

  const descendantFolders = await prisma.folder.findMany({
    where: {
      deletedAt: null,
      OR: [{ path }, { path: { startsWith: `${path}/` } }],
    },
    select: { id: true, path: true },
  });

  const folderById = new Map(
    descendantFolders.map((f) => [f.id, f.path] as const),
  );
  const folderIds = descendantFolders.map((f) => f.id);

  const mediaRows = await prisma.media.findMany({
    where: { folderId: { in: folderIds }, deletedAt: null },
    select: { name: true, s3Key: true, folderId: true },
    orderBy: { name: "asc" },
  });

  const prefix = `${path}/`;
  const entries: FolderDownloadEntry[] = [];
  const usedZipPaths = new Set<string>();

  for (const row of mediaRows) {
    if (!row.folderId) continue;
    const mediaFolderPath = folderById.get(row.folderId);
    if (mediaFolderPath === undefined) continue;

    const relative =
      mediaFolderPath === path
        ? row.name
        : mediaFolderPath.startsWith(prefix)
          ? `${mediaFolderPath.slice(prefix.length)}/${row.name}`
          : row.name;

    let zipPath = `${folder.name}/${relative}`;
    if (usedZipPaths.has(zipPath)) {
      const dot = row.name.lastIndexOf(".");
      const stem = dot > 0 ? row.name.slice(0, dot) : row.name;
      const ext = dot > 0 ? row.name.slice(dot) : "";
      let n = 2;
      do {
        const altName = `${stem} (${n})${ext}`;
        zipPath =
          mediaFolderPath === path
            ? `${folder.name}/${altName}`
            : `${folder.name}/${mediaFolderPath.slice(prefix.length)}/${altName}`;
        n += 1;
      } while (usedZipPaths.has(zipPath));
    }
    usedZipPaths.add(zipPath);
    entries.push({ zipPath, s3Key: row.s3Key });
  }

  return { folderName: folder.name, entries };
}
