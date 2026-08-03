"use client";

import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { addMediaTagsBulk, removeMediaTagsBulk } from "@/lib/actions";

type TagChip = { id?: string; text: string };

function commonTags(tagLists: TagChip[][]): TagChip[] {
  if (tagLists.length === 0) return [];
  const [first, ...rest] = tagLists;
  return first.filter((tag) =>
    rest.every((list) =>
      list.some((t) => t.text.toLowerCase() === tag.text.toLowerCase()),
    ),
  );
}

function BulkTagForm({
  s3Keys,
  initialTagLists,
  onClose,
  onDone,
}: {
  s3Keys: string[];
  initialTagLists: TagChip[][];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [shared, setShared] = useState(() => commonTags(initialTagLists));
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<
    { id: string; text: string }[]
  >([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sharedLower = useMemo(
    () => new Set(shared.map((t) => t.text.toLowerCase())),
    [shared],
  );

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tags?q=${encodeURIComponent(input.trim())}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; text: string }[];
        setSuggestions(
          data.filter((s) => !sharedLower.has(s.text.toLowerCase())),
        );
      } catch {
        /* aborted */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [input, open, sharedLower]);

  function addTag(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (sharedLower.has(trimmed.toLowerCase())) {
      setInput("");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      try {
        await addMediaTagsBulk(s3Keys, [trimmed]);
        setShared((prev) => [...prev, { text: trimmed }]);
        setInput("");
        setOpen(false);
        setStatus(`Added “${trimmed}” to ${s3Keys.length} items`);
        onDone();
        router.refresh();
      } catch {
        setError("Could not add tag");
      }
    });
  }

  function removeTag(text: string) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      try {
        await removeMediaTagsBulk(s3Keys, [text]);
        setShared((prev) =>
          prev.filter((t) => t.text.toLowerCase() !== text.toLowerCase()),
        );
        setStatus(`Removed “${text}” from ${s3Keys.length} items`);
        onDone();
        router.refresh();
      } catch {
        setError("Could not remove tag");
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const exact = suggestions.find(
        (s) => s.text.toLowerCase() === input.trim().toLowerCase(),
      );
      addTag(exact?.text ?? input);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-tag-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
        <h2
          id="bulk-tag-title"
          className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
        >
          Tags for {s3Keys.length} item{s3Keys.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Shared tags are shown below. Add a tag to apply it to all selected
          media, or remove a shared tag from all.
        </p>

        <div ref={wrapRef} className="relative mt-4 min-w-0">
          <div
            className={`flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 ${
              pending ? "opacity-70" : ""
            }`}
          >
            {shared.map((tag, i) => (
              <span
                key={`${tag.text}-${i}`}
                className="inline-flex items-center gap-1 rounded bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink)]"
              >
                {tag.text}
                <button
                  type="button"
                  onClick={() => removeTag(tag.text)}
                  disabled={pending}
                  className="text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50"
                  aria-label={`Remove ${tag.text} from all`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              disabled={pending}
              placeholder={shared.length ? "Add to all…" : "Add tags to all…"}
              className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
            />
          </div>
          {open && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-md">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s.text);
                    }}
                  >
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {status && (
          <p className="mt-2 text-xs text-[var(--muted)]">{status}</p>
        )}
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function BulkTagDialog({
  s3Keys,
  tagLists,
  open,
  onClose,
  onDone,
}: {
  s3Keys: string[];
  tagLists: TagChip[][];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!open) return null;
  return (
    <BulkTagForm
      key={s3Keys.join("|")}
      s3Keys={s3Keys}
      initialTagLists={tagLists}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
