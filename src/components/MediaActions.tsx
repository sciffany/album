"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { softDeleteMediaAction } from "@/lib/actions";
import { MoveMediaDialog } from "@/components/MoveMediaDialog";

export function MediaActions({ s3Key }: { s3Key: string }) {
  const router = useRouter();
  const [moveOpen, setMoveOpen] = useState(false);
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

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
      />
    </div>
  );
}
