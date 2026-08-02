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

export function isMediaKey(key: string): boolean {
  const base = key.split("/").pop() ?? key;
  if (base.startsWith(".")) return false;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXT.has(ext);
}
