"use client";

import {
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  moveFolderAction,
  softDeleteFolderAction,
} from "@/lib/actions";
import { parentFolder } from "@/lib/storage-keys";

export function FolderActions({
  path,
  name,
}: {
  path: string;
  name: string;
}) {
  const router = useRouter();
  const [moveOpen, setMoveOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Move folder "${name}" and all files inside to the recycle bin?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await softDeleteFolderAction(path);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not delete folder",
        );
      }
    });
  }

  function onMoveOpen(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDestination(parentFolder(path));
    setError(null);
    setMoveOpen(true);
  }

  function submitMove(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    const dest = destination.trim();
    const toPath = dest ? `${dest}/${name}`.replace(/\/+/g, "/") : name;
    startTransition(async () => {
      try {
        await moveFolderAction(path, toPath);
        setMoveOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move folder");
      }
    });
  }

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      onClick={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={onMoveOpen}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
      >
        Move
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-red-800 transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Working…" : "Delete"}
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}

      {moveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setMoveOpen(false);
          }}
        >
          <form
            onSubmit={submitMove}
            className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Move folder
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Moving <span className="text-[var(--ink)]">{path}</span>
            </p>
            <label className="mt-4 block text-xs font-medium text-[var(--muted)]">
              Parent destination folder
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Archive (empty = root)"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              />
            </label>
            <p className="mt-2 text-xs text-[var(--muted)]">
              New path:{" "}
              <span className="text-[var(--ink)]">
                {destination.trim()
                  ? `${destination.trim()}/${name}`
                  : name}
              </span>
            </p>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveOpen(false)}
                disabled={pending}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {pending ? "Moving…" : "Move"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
