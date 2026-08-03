"use client";

import {
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { renameMediaAction, softDeleteMediaAction } from "@/lib/actions";
import { MoveMediaDialog } from "@/components/MoveMediaDialog";

export function MediaActions({
  s3Key,
  name,
  folderPath,
}: {
  s3Key: string;
  name: string;
  folderPath: string;
}) {
  const router = useRouter();
  const [moveOpen, setMoveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (
      !confirm(
        "Move this file to the recycle bin? You can restore it later from Trash.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await softDeleteMediaAction(s3Key);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete file");
      }
    });
  }

  function onRenameOpen() {
    setNewName(name);
    setError(null);
    setRenameOpen(true);
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) {
      setRenameOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        const result = await renameMediaAction(s3Key, trimmed);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRenameOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not rename file");
      }
    });
  }

  const previewPath = folderPath
    ? `${folderPath}/${newName.trim() || name}`
    : newName.trim() || name;

  const downloadHref = `/api/s3/object?key=${encodeURIComponent(s3Key)}&download=1&filename=${encodeURIComponent(name)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={downloadHref}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
      >
        Download
      </a>
      <button
        type="button"
        onClick={onRenameOpen}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => setMoveOpen(true)}
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
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
      <MoveMediaDialog
        s3Key={s3Key}
        name={name}
        folderPath={folderPath}
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
      />

      {renameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-media-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setRenameOpen(false);
          }}
        >
          <form
            onSubmit={submitRename}
            className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
          >
            <h2
              id="rename-media-title"
              className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
            >
              Rename file
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">{name}</p>
            <label className="mt-4 block text-xs font-medium text-[var(--muted)]">
              File name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                autoFocus
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              />
            </label>
            <p className="mt-2 truncate text-xs text-[var(--muted)]">
              Path: <span className="text-[var(--ink)]">{previewPath}</span>
            </p>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                disabled={pending}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !newName.trim()}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {pending ? "Renaming…" : "Rename"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
