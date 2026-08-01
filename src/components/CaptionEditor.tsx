"use client";

import { useState, useTransition } from "react";
import { updateCaption } from "@/lib/actions";

export function CaptionEditor({
  mediaId,
  initialCaption,
  aiCaption,
}: {
  mediaId: string;
  initialCaption: string | null;
  aiCaption?: string | null;
}) {
  const [value, setValue] = useState(initialCaption ?? "");
  const [baseline, setBaseline] = useState(initialCaption ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(next: string) {
    if (next === baseline) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateCaption(mediaId, next);
        setBaseline(next);
        setSaved(true);
      } catch {
        setError("Could not save caption");
      }
    });
  }

  return (
    <div className="min-w-0">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        onBlur={() => save(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={2}
        placeholder="Caption…"
        className={`w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2 ${
          pending ? "opacity-70" : ""
        }`}
      />
      {aiCaption && (
        <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
          AI: {aiCaption}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {saved && !error && (
        <p className="mt-1 text-xs text-[var(--accent)]">Saved</p>
      )}
    </div>
  );
}
