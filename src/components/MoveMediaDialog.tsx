"use client";

import {
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { moveMediaAction } from "@/lib/actions";
import { DestinationFolderPicker } from "@/components/DestinationFolderPicker";
import { parentFolder, baseName } from "@/lib/storage-keys";

function MoveMediaForm({
  s3Key,
  onClose,
}: {
  s3Key: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState(() => parentFolder(s3Key));
  const [name, setName] = useState(() => baseName(s3Key));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await moveMediaAction(s3Key, folder, name);
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move file");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-media-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
      >
        <h2
          id="move-media-title"
          className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
        >
          Move file
        </h2>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">{s3Key}</p>

        <div className="mt-4">
          <DestinationFolderPicker folder={folder} onFolderChange={setFolder} />
        </div>

        <label className="mt-3 block text-xs font-medium text-[var(--muted)]">
          File name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
          />
        </label>

        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? "Moving…" : "Move"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function MoveMediaDialog({
  s3Key,
  open,
  onClose,
}: {
  s3Key: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <MoveMediaForm key={s3Key} s3Key={s3Key} onClose={onClose} />;
}
