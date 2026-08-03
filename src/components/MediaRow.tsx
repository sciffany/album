"use client";

import { useState, type MouseEvent } from "react";
import { TagEditor } from "@/components/TagEditor";
import { CaptionEditor } from "@/components/CaptionEditor";
import { MediaActions } from "@/components/MediaActions";
import { SelectionCheckbox } from "@/components/SelectionCheckbox";

export type MediaItem = {
  s3Key: string;
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

function fileName(key: string) {
  return key.split("/").pop() || key;
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
  const objectHref = `/api/s3/object?key=${encodeURIComponent(media.s3Key)}`;
  const dateLabel = formatDate(media.datetimeTaken);

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
            label={`Select ${fileName(media.s3Key)}`}
            onToggle={onToggleSelect}
          />
        )}
        <a
          href={objectHref}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block h-full w-full overflow-hidden rounded-md bg-[var(--surface-2)]"
        >
          {!thumbFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={objectHref}
              alt={media.caption || fileName(media.s3Key)}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
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
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="truncate text-xs text-[var(--muted)]">
          {dateLabel ? `${dateLabel} · ` : ""}
          {fileName(media.s3Key)}
        </p>
        <TagEditor
          key={`tags-${media.s3Key}`}
          s3Key={media.s3Key}
          initialTags={media.tags.map((t) => ({
            id: t.tag.id,
            text: t.tag.text,
          }))}
        />
        <CaptionEditor
          key={`caption-${media.s3Key}`}
          s3Key={media.s3Key}
          initialCaption={media.caption}
          aiCaption={media.aiCaption}
        />
        <MediaActions s3Key={media.s3Key} />
      </div>
    </article>
  );
}
