/** Reserved top-level prefix for soft-deleted objects. */
export const TRASH_ROOT = "_trash";

export function assertValidKey(key: string, label = "S3 key"): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error(`Invalid ${label}`);
  if (trimmed.includes("\0") || trimmed.startsWith("/") || trimmed.includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
  if (trimmed.endsWith("/")) {
    throw new Error(`${label} must be an object key, not a folder prefix`);
  }
  return trimmed;
}

/** Normalize a folder path (no leading/trailing slashes). Empty string = bucket root. */
export function normalizeFolderPath(path: string): string {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

export function assertValidFolderPath(path: string, label = "folder path"): string {
  const normalized = normalizeFolderPath(path);
  if (normalized.includes("\0") || normalized.includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
  if (normalized === TRASH_ROOT || normalized.startsWith(`${TRASH_ROOT}/`)) {
    throw new Error(`Cannot use the reserved ${TRASH_ROOT} path`);
  }
  return normalized;
}

export function isTrashKey(key: string): boolean {
  return key === TRASH_ROOT || key.startsWith(`${TRASH_ROOT}/`);
}

export function isTrashFolderPath(path: string): boolean {
  const normalized = normalizeFolderPath(path);
  return (
    normalized === TRASH_ROOT || normalized.startsWith(`${TRASH_ROOT}/`)
  );
}

/** Build a unique trash key that preserves the original path under a timestamped folder. */
export function makeTrashKey(originalKey: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = crypto.randomUUID().slice(0, 8);
  return `${TRASH_ROOT}/${stamp}-${id}/${originalKey}`;
}

/**
 * Recover the pre-delete key from `_trash/<stamp-id>/<originalKey>`.
 * Returns null when the trash key shape is unexpected.
 */
export function originalKeyFromTrashKey(trashKey: string): string | null {
  if (!isTrashKey(trashKey) || trashKey === TRASH_ROOT) return null;
  const rest = trashKey.slice(TRASH_ROOT.length + 1);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return rest.slice(slash + 1);
}

export function joinKey(folderPath: string, fileName: string): string {
  const folder = normalizeFolderPath(folderPath);
  const name = fileName.trim();
  if (!name || name.includes("/") || name.includes("\0") || name.includes("..")) {
    throw new Error("Invalid file name");
  }
  return folder ? `${folder}/${name}` : name;
}

/** Zero-byte S3 key that materializes an empty folder prefix. */
export function folderMarkerKey(folderPath: string): string {
  const folder = assertValidFolderPath(folderPath, "folder path");
  if (!folder) throw new Error("Cannot create a marker for the bucket root");
  return `${folder}/`;
}

/** Validate a single folder name segment (no slashes). */
export function assertValidFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Folder name is required");
  if (
    trimmed.includes("/") ||
    trimmed.includes("\0") ||
    trimmed.includes("..") ||
    trimmed === "." ||
    trimmed === TRASH_ROOT
  ) {
    throw new Error("Invalid folder name");
  }
  return trimmed;
}

/**
 * Join a browse folder with a relative upload path (may include nested
 * directories from a directory picker). Rejects `..` and empty segments.
 */
export function joinRelativeKey(
  folderPath: string,
  relativePath: string,
): string {
  const folder = assertValidFolderPath(folderPath || "");
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
  if (!normalized) throw new Error("Invalid relative path");

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\0")
    ) {
      throw new Error("Invalid relative path");
    }
  }

  const key = folder ? `${folder}/${normalized}` : normalized;
  return assertValidKey(key);
}

export function parentFolder(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? "" : key.slice(0, i);
}

export function baseName(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? key : key.slice(i + 1);
}
