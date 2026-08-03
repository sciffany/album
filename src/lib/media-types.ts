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

export function baseNameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

export function extFromKey(key: string): string {
  const base = baseNameFromKey(key);
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/** Dotfiles and folder markers are not browsable library entries. */
export function isBrowsableObjectKey(key: string): boolean {
  if (!key || key.endsWith("/")) return false;
  return !baseNameFromKey(key).startsWith(".");
}

export function isMediaKey(key: string): boolean {
  if (!isBrowsableObjectKey(key)) return false;
  return MEDIA_EXT.has(extFromKey(key));
}
