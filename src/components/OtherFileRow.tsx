"use client";

import type { MouseEvent } from "react";
import { MediaActions } from "@/components/MediaActions";
import { SelectionCheckbox } from "@/components/SelectionCheckbox";
import { baseNameFromKey, extFromKey } from "@/lib/media-types";
import { parentFolder } from "@/lib/storage-keys";

export type OtherFileItem = {
  s3Key: string;
  size: number;
  lastModified: Date | string | null;
};

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function OtherFileRow({
  file,
  selected = false,
  onToggleSelect,
}: {
  file: OtherFileItem;
  selected?: boolean;
  onToggleSelect?: (e: MouseEvent) => void;
}) {
  const name = baseNameFromKey(file.s3Key);
  const ext = extFromKey(file.s3Key);
  const objectHref = `/api/s3/object?key=${encodeURIComponent(file.s3Key)}`;
  const sizeLabel = formatSize(file.size);

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
            label={`Select ${name}`}
            onToggle={onToggleSelect}
          />
        )}
        <a
          href={objectHref}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-md bg-[var(--surface-2)]"
        >
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
        </a>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="truncate font-[family-name:var(--font-display)] text-base text-[var(--ink)]">
            {name}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Other file
            {sizeLabel ? ` · ${sizeLabel}` : ""}
          </p>
        </div>
        <MediaActions
          s3Key={file.s3Key}
          name={name}
          folderPath={parentFolder(file.s3Key)}
        />
      </div>
    </article>
  );
}
