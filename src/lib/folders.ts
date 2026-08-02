import { prisma } from "@/lib/prisma";
import { listPrefix, prefixExists, type S3Folder } from "@/lib/s3";

const MEDIA_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
  "bmp",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
]);

export type FolderItem = S3Folder;

export type MediaListItem = {
  s3Key: string;
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
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["gif"].includes(ext)) return "meme";
  return "photo";
}

function isMediaKey(key: string): boolean {
  const base = key.split("/").pop() ?? key;
  if (base.startsWith(".")) return false;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXT.has(ext);
}

export async function assertPrefixExists(path: string) {
  return prefixExists(path);
}

export async function listFolderContents(path: string): Promise<{
  folders: FolderItem[];
  media: MediaListItem[];
}> {
  const { folders, objects } = await listPrefix(path);
  const mediaObjects = objects.filter((o) => isMediaKey(o.key));
  const keys = mediaObjects.map((o) => o.key);

  const meta =
    keys.length === 0
      ? []
      : await prisma.media.findMany({
          where: { s3Key: { in: keys } },
          include: { tags: { include: { tag: true } } },
        });

  const byKey = new Map(meta.map((m) => [m.s3Key, m]));

  const media: MediaListItem[] = mediaObjects.map((obj) => {
    const row = byKey.get(obj.key);
    return {
      s3Key: obj.key,
      mediaType: mediaTypeFromKey(obj.key),
      datetimeTaken: row?.datetimeTaken ?? null,
      caption: row?.caption ?? null,
      aiCaption: row?.aiCaption ?? null,
      tags: row?.tags ?? [],
    };
  });

  media.sort((a, b) => {
    const at = a.datetimeTaken?.getTime() ?? 0;
    const bt = b.datetimeTaken?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.s3Key.localeCompare(b.s3Key);
  });

  return { folders, media };
}
