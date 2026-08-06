/** Must match the cookie name set in middleware. */
export const SHARE_COOKIE_NAME = "album_share";

export function sharePath(token: string, relativePath = ""): string {
  const base = `/s/${encodeURIComponent(token)}`;
  if (!relativePath) return base;
  return `${base}/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Absolute path under the share root, or null if outside / invalid. */
export function resolveShareBrowsePath(
  shareRootPath: string,
  relativePath: string,
): string | null {
  const root = shareRootPath;
  const rel = relativePath.replace(/^\/+|\/+$/g, "");
  if (!rel) return root;
  if (rel.includes("..") || rel.includes("\0")) return null;
  const absolute = `${root}/${rel}`.replace(/\/+/g, "/");
  if (absolute !== root && !absolute.startsWith(`${root}/`)) return null;
  return absolute;
}

/** Relative path from share root for breadcrumbs / child folder links. */
export function relativePathFromShareRoot(
  shareRootPath: string,
  absolutePath: string,
): string {
  if (absolutePath === shareRootPath) return "";
  const prefix = `${shareRootPath}/`;
  if (!absolutePath.startsWith(prefix)) return "";
  return absolutePath.slice(prefix.length);
}

export function isPathUnderShareRoot(
  shareRootPath: string,
  absolutePath: string,
): boolean {
  return (
    absolutePath === shareRootPath ||
    absolutePath.startsWith(`${shareRootPath}/`)
  );
}
