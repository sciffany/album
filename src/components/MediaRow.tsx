"use client";

import { useState, type MouseEvent } from "react";
import { TagEditor } from "@/components/TagEditor";
import { CaptionEditor } from "@/components/CaptionEditor";
import { MediaActions } from "@/components/MediaActions";
import { MediaViewer } from "@/components/MediaViewer";
import { SelectionCheckbox } from "@/components/SelectionCheckbox";
import { extFromKey } from "@/lib/media-types";

export type MediaItem = {
  id: string;
  name: string;
  s3Key: string;
  folderPath: string;
  mediaType: string;
  caption: string | null;
  aiCaption: string | null;
  datetimeTaken: Date | string | null;
  tags: { tag: { id: string; text: string } }[];
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** UTC calendar date — stable across server/client locales and timezones. */
function formatDate(value: Date | string | null) {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function MediaRow({
  media,
  selected = false,
  onToggleSelect,
}: {
  media: MediaItem;
  selected?: boolean;
  onToggleSelect?: (e: MouseEvent) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const objectHref = `/api/s3/object?key=${encodeURIComponent(media.s3Key)}`;
  const dateLabel = formatDate(media.datetimeTaken);
  const isVideo = media.mediaType === "video";
  const isFile = media.mediaType === "file";
  const ext = extFromKey(media.name);

  return (
    <article
      className={`flex gap-3 rounded-lg border p-2 transition sm:gap-4 ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface)]/60"
      }`}
    >
      <div className="relative h-28 w-28 shrink-0 sm:h-36 sm:w-36">
        {onToggleSelect && (
          <SelectionCheckbox
            checked={selected}
            label={`Select ${media.name}`}
            onToggle={onToggleSelect}
          />
        )}
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="relative block h-full w-full overflow-hidden rounded-md bg-[var(--surface-2)] text-left"
          aria-label={`View ${media.name}`}
        >
          {isFile ? (
            <span className="flex h-full w-full flex-col items-center justify-center gap-2">
              <svg
                viewBox="0 0 24 24"
                className="h-10 w-10 text-[var(--muted)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
              </svg>
              <span className="max-w-[85%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
                {ext || "file"}
              </span>
            </span>
          ) : !thumbFailed && !isVideo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={objectHref}
              alt={media.caption || media.name}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setThumbFailed(true)}
            />
          ) : isVideo ? (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-0.5" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              Play
            </span>
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <span className="text-lg leading-none" aria-hidden>
                ↗
              </span>
              View
            </span>
          )}
          {media.mediaType !== "photo" && !isFile && (
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
              {media.mediaType}
            </span>
          )}
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="truncate text-xs text-[var(--muted)]">
          {dateLabel ? `${dateLabel} · ` : ""}
          {media.name}
        </p>
        <TagEditor
          key={`tags-${media.id}`}
          s3Key={media.s3Key}
          initialTags={media.tags.map((t) => ({
            id: t.tag.id,
            text: t.tag.text,
          }))}
        />
        <CaptionEditor
          key={`caption-${media.id}`}
          s3Key={media.s3Key}
          initialCaption={media.caption}
          aiCaption={media.aiCaption}
        />
        <MediaActions
          s3Key={media.s3Key}
          name={media.name}
          folderPath={media.folderPath}
        />
      </div>

      <MediaViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        src={objectHref}
        name={media.name}
        caption={media.caption}
        mediaType={media.mediaType}
      />
    </article>
  );
}
