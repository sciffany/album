import { isBrowsableObjectKey, isMediaKey } from "@/lib/media-types";
import { prisma } from "@/lib/prisma";
import { listPrefix, prefixExists, type S3Folder } from "@/lib/s3";
import { isTrashFolderPath, TRASH_ROOT } from "@/lib/storage-keys";

export type FolderItem = S3Folder;

export type MediaListItem = {
  s3Key: string;
  mediaType: string;
  datetimeTaken: Date | null;
  caption: string | null;
  aiCaption: string | null;
  tags: { tag: { id: string; text: string } }[];
};

export type OtherFileItem = {
  s3Key: string;
  size: number;
  lastModified: Date | null;
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

export async function assertPrefixExists(path: string) {
  return prefixExists(path);
}

export async function listFolderContents(path: string): Promise<{
  folders: FolderItem[];
  media: MediaListItem[];
  otherFiles: OtherFileItem[];
}> {
  if (isTrashFolderPath(path)) {
    return { folders: [], media: [], otherFiles: [] };
  }

  const { folders: rawFolders, objects } = await listPrefix(path);
  const folders = rawFolders.filter(
    (f) => !(path === "" && f.name === TRASH_ROOT),
  );
  const browsable = objects.filter(
    (o) => isBrowsableObjectKey(o.key) && !isTrashFolderPath(o.key),
  );
  const mediaObjects = browsable.filter((o) => isMediaKey(o.key));
  const otherObjects = browsable.filter((o) => !isMediaKey(o.key));
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

  const otherFiles: OtherFileItem[] = otherObjects.map((obj) => ({
    s3Key: obj.key,
    size: obj.size,
    lastModified: obj.lastModified,
  }));

  return { folders, media, otherFiles };
}
