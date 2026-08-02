"use client";

import { useState } from "react";
import { TagEditor } from "@/components/TagEditor";
import { CaptionEditor } from "@/components/CaptionEditor";

export type MediaItem = {
  id: string;
  url: string;
  thumbnailPath: string | null;
  mediaType: string;
  caption: string | null;
  aiCaption: string | null;
  dateTaken: Date | string | null;
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

export function MediaRow({ media }: { media: MediaItem }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc = media.thumbnailPath
    ? `/api/media/${media.id}/thumbnail`
    : null;
  const dateLabel = formatDate(media.dateTaken);

  return (
    <article className="flex gap-3 rounded-lg border border-transparent p-2 transition hover:border-[var(--border)] hover:bg-[var(--surface)]/60 sm:gap-4">
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md bg-[var(--surface-2)] sm:h-36 sm:w-36"
      >
        {thumbSrc && !thumbFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={media.caption || "Media"}
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <span className="text-lg leading-none" aria-hidden>
              ↗
            </span>
            Open
          </span>
        )}
        {media.mediaType !== "photo" && (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
            {media.mediaType}
          </span>
        )}
      </a>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {dateLabel && (
          <p className="text-xs text-[var(--muted)]">{dateLabel}</p>
        )}
        <TagEditor
          key={`tags-${media.id}`}
          mediaId={media.id}
          initialTags={media.tags.map((t) => ({
            id: t.tag.id,
            text: t.tag.text,
          }))}
        />
        <CaptionEditor
          key={`caption-${media.id}`}
          mediaId={media.id}
          initialCaption={media.caption}
          aiCaption={media.aiCaption}
        />
      </div>
    </article>
  );
}
