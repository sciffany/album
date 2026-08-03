"use client";

import {
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { moveItemsBulkAction } from "@/lib/actions";
import { DestinationFolderPicker } from "@/components/DestinationFolderPicker";
import type { SelectedItem } from "@/lib/selection";

function BulkMoveForm({
  items,
  onClose,
  onDone,
}: {
  items: SelectedItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const folderCount = items.filter((i) => i.kind === "folder").length;
  const fileCount = items.filter((i) => i.kind === "file").length;
  const total = items.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const files = items
          .filter((i): i is Extract<SelectedItem, { kind: "file" }> => i.kind === "file")
          .map((i) => i.s3Key);
        const folders = items
          .filter(
            (i): i is Extract<SelectedItem, { kind: "folder" }> =>
              i.kind === "folder",
          )
          .map((i) => i.path);

        const result = await moveItemsBulkAction({ files, folders }, folder);
        if (result.errors.length > 0 && result.moved === 0) {
          setError(
            result.errors
              .slice(0, 3)
              .map((err) => err.message)
              .join("; "),
          );
          return;
        }
        if (result.errors.length > 0) {
          setError(
            `Moved ${result.moved}; ${result.errors.length} failed: ${result.errors[0].message}`,
          );
          onDone();
          router.refresh();
          return;
        }
        onDone();
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move items");
      }
    });
  }

  const summaryParts = [];
  if (folderCount) {
    summaryParts.push(
      `${folderCount} folder${folderCount === 1 ? "" : "s"}`,
    );
  }
  if (fileCount) {
    summaryParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-move-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
      >
        <h2
          id="bulk-move-title"
          className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
        >
          Move {total} item{total === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {summaryParts.join(" · ")}. Names are kept; choose a destination
          folder.
        </p>

        <div className="mt-4">
          <DestinationFolderPicker folder={folder} onFolderChange={setFolder} />
        </div>

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
            disabled={pending || total === 0}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? "Moving…" : "Move"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BulkMoveDialog({
  items,
  open,
  onClose,
  onDone,
}: {
  items: SelectedItem[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!open) return null;
  return (
    <BulkMoveForm
      key={items.map((i) => (i.kind === "folder" ? i.path : i.s3Key)).join("|")}
      items={items}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
