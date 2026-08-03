"use client";

export function BulkActionBar({
  count,
  mediaCount,
  onMove,
  onTags,
  onSelectAll,
  onClear,
}: {
  count: number;
  mediaCount: number;
  onMove: () => void;
  onTags: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  const tagsDisabled = mediaCount === 0;

  return (
    <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm">
      <p className="mr-auto text-sm text-[var(--ink)]">
        {count} selected
        {mediaCount > 0 && mediaCount !== count
          ? ` · ${mediaCount} media`
          : ""}
      </p>
      <button
        type="button"
        onClick={onSelectAll}
        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]"
      >
        Select all
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onMove}
        className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs text-white hover:bg-[var(--accent-hover)]"
      >
        Move
      </button>
      <button
        type="button"
        onClick={onTags}
        disabled={tagsDisabled}
        title={
          tagsDisabled
            ? "Select at least one photo or video to edit tags"
            : "Add or remove tags on selected media"
        }
        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Tags
      </button>
    </div>
  );
}
