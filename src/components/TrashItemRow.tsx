"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purgeMediaAction, restoreMediaAction } from "@/lib/actions";

export function TrashItemRow({
  s3Key,
  originalS3Key,
  deletedAt,
  caption,
  mediaType,
}: {
  s3Key: string;
  originalS3Key: string | null;
  deletedAt: Date | string | null;
  caption: string | null;
  mediaType: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const objectHref = `/api/s3/object?key=${encodeURIComponent(s3Key)}`;
  const restoreLabel = originalS3Key ?? "original location";
  const deletedLabel = deletedAt
    ? new Date(deletedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  function restore() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreMediaAction(s3Key);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not restore");
      }
    });
  }

  function purge() {
    if (
      !confirm(
        "Permanently delete this file from storage? This cannot be undone.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await purgeMediaAction(s3Key);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      }
    });
  }

  return (
    <article className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 p-2 sm:gap-4">
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md bg-[var(--surface-2)] sm:h-36 sm:w-36">
        {!thumbFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={objectHref}
            alt={caption || restoreLabel}
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
            No preview
          </span>
        )}
        {mediaType !== "photo" && (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
            {mediaType}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="truncate text-sm text-[var(--ink)]">
            {originalS3Key ?? s3Key}
          </p>
          {deletedLabel && (
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Deleted {deletedLabel}
            </p>
          )}
          {caption && (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
              {caption}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={restore}
            disabled={pending || !originalS3Key}
            className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? "Working…" : "Restore"}
          </button>
          <button
            type="button"
            onClick={purge}
            disabled={pending}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            Delete forever
          </button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </article>
  );
}
