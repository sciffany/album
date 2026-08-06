import { notFound } from "next/navigation";
import { FolderGrid } from "@/components/FolderGrid";
import { getActiveTagShareByToken } from "@/lib/shares";
import { listMediaByTagSlug } from "@/lib/tags";

export default async function TagSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken);
  const share = await getActiveTagShareByToken(token);
  if (!share) {
    notFound();
  }

  const tagged = await listMediaByTagSlug(share.tagSlug);
  if (!tagged) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          {tagged.text}
        </h1>
        <p className="text-sm text-[var(--muted)]">Shared tag · view only</p>
      </div>
      {tagged.media.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">
          No media with this tag.
        </p>
      ) : (
        <FolderGrid folders={[]} media={tagged.media} readOnly />
      )}
    </div>
  );
}
