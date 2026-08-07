"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emptyTrashAction } from "@/lib/actions";

export function EmptyTrashButton({ itemCount }: { itemCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function emptyTrash() {
    if (
      !confirm(
        `Permanently delete all ${itemCount} item${itemCount === 1 ? "" : "s"} from storage? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await emptyTrashAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.errors.length > 0) {
          setError(
            `Deleted ${result.purged} item${result.purged === 1 ? "" : "s"}, but ${result.errors.length} failed.`,
          );
        }
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not empty recycle bin",
        );
      }
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={emptyTrash}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-red-800 transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Emptying…" : "Empty recycle bin"}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
