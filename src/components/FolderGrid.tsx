import Link from "next/link";
import { MediaRow, type MediaItem } from "@/components/MediaRow";

type FolderItem = {
  id: number;
  name: string;
  path: string;
};

export function FolderGrid({
  folders,
  media,
}: {
  folders: FolderItem[];
  media: MediaItem[];
}) {
  if (folders.length === 0 && media.length === 0) {
    return (
      <p className="py-16 text-center text-[var(--muted)]">
        This folder is empty. Run your ingestion script to add media.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {folders.map((folder) => (
        <Link
          key={folder.id}
          href={`/browse/${folder.path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`}
          className="flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-[var(--border)] hover:bg-[var(--surface)]/60"
        >
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-[var(--folder)] sm:h-36 sm:w-36">
            <svg
              viewBox="0 0 24 24"
              className="h-14 w-14 text-[var(--folder-ink)]"
              fill="currentColor"
              aria-hidden
            >
              <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
              {folder.name}
            </p>
            <p className="text-xs text-[var(--muted)]">Folder</p>
          </div>
        </Link>
      ))}
      {media.map((item) => (
        <MediaRow key={item.id} media={item} />
      ))}
    </div>
  );
}
