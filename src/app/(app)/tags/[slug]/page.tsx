import { notFound } from "next/navigation";
import { FolderGrid } from "@/components/FolderGrid";
import { TagShareControls } from "@/components/TagShareControls";
import { listMediaByTagSlug } from "@/lib/tags";

export default async function TagBrowsePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const tagged = await listMediaByTagSlug(slug);
  if (!tagged) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {tagged.text}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {tagged.media.length} item{tagged.media.length === 1 ? "" : "s"} with
            this tag
          </p>
        </div>
        <TagShareControls slug={tagged.slug} />
      </div>
      {tagged.media.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">
          No media with this tag.
        </p>
      ) : (
        <FolderGrid folders={[]} media={tagged.media} />
      )}
    </div>
  );
}
