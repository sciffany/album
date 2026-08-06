/** Client-safe tag slug helper (no DB imports). */
export function slugifyTag(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
