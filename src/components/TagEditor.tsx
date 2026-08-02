"use client";

import {
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { setMediaTags } from "@/lib/actions";

type TagChip = { id?: string; text: string };

export function TagEditor({
  s3Key,
  initialTags,
}: {
  s3Key: string;
  initialTags: TagChip[];
}) {
  const [tags, setTags] = useState<TagChip[]>(initialTags);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; text: string }[]>(
    [],
  );
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
        const existing = new Set(tags.map((tag) => tag.text.toLowerCase()));
        setSuggestions(
          data.filter((s) => !existing.has(s.text.toLowerCase())),
        );
      } catch {
        /* aborted */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [input, open, tags]);

  function persist(next: TagChip[]) {
    setTags(next);
    setError(null);
    startTransition(async () => {
      try {
        await setMediaTags(
          s3Key,
          next.map((t) => t.text),
        );
      } catch {
        setError("Could not save tags");
      }
    });
  }

  function addTag(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.text.toLowerCase() === trimmed.toLowerCase())) {
      setInput("");
      return;
    }
    persist([...tags, { text: trimmed }]);
    setInput("");
    setOpen(false);
  }

  function removeTag(index: number) {
    persist(tags.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const exact = suggestions.find(
        (s) => s.text.toLowerCase() === input.trim().toLowerCase(),
      );
      addTag(exact?.text ?? input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 ${
          pending ? "opacity-70" : ""
        }`}
      >
        {tags.map((tag, i) => (
          <span
            key={`${tag.text}-${i}`}
            className="inline-flex items-center gap-1 rounded bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--ink)]"
          >
            {tag.text}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="text-[var(--muted)] hover:text-[var(--ink)]"
              aria-label={`Remove ${tag.text}`}
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
          onBlur={() => {
            if (input.trim()) addTag(input);
          }}
          placeholder={tags.length ? "" : "Add tags…"}
          className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-[var(--muted)]"
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
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
