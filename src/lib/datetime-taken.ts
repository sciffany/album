import exifr from "exifr";
import { extFromKey, baseNameFromKey } from "@/lib/media-types";
import { getObjectBytes } from "@/lib/s3";

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

const VIDEO_EXT = new Set(["mp4", "mov", "m4v"]);

/** Bytes to fetch for stills — EXIF APP1 is almost always near the start. */
const IMAGE_RANGE_BYTES = 512 * 1024;
/** Videos need a larger head for the moov/meta atoms. */
const VIDEO_RANGE_BYTES = 2 * 1024 * 1024;

export function isSupportedDatetimeMedia(keyOrName: string): boolean {
  if (baseNameFromKey(keyOrName).startsWith(".")) return false;
  const ext = extFromKey(keyOrName);
  return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext);
}

function isVideo(keyOrName: string): boolean {
  return VIDEO_EXT.has(extFromKey(keyOrName));
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Read capture time from object metadata in S3 (EXIF DateTimeOriginal,
 * falling back to CreateDate / QuickTime dates). Returns null when the
 * type is unsupported or no usable date is found.
 */
export async function extractDatetimeTaken(
  key: string,
): Promise<Date | null> {
  if (!isSupportedDatetimeMedia(key)) return null;

  const byteLength = isVideo(key) ? VIDEO_RANGE_BYTES : IMAGE_RANGE_BYTES;
  const buf = await getObjectBytes(key, { byteLength });

  const tags = await exifr.parse(buf, {
    pick: [
      "DateTimeOriginal",
      "CreateDate",
      "MediaCreateDate",
      "TrackCreateDate",
      "ModifyDate",
    ],
    // Still EXIF + HEIC/AVIF + QuickTime/MP4.
    tiff: true,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false,
    translateKeys: true,
    translateValues: true,
    reviveValues: true,
    sanitize: true,
    mergeOutput: true,
  });

  if (!tags || typeof tags !== "object") return null;

  const record = tags as Record<string, unknown>;
  return (
    asDate(record.DateTimeOriginal) ??
    asDate(record.CreateDate) ??
    asDate(record.MediaCreateDate) ??
    asDate(record.TrackCreateDate) ??
    asDate(record.ModifyDate)
  );
}
