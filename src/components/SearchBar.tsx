"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function SearchBar({ initialQ = "" }: { initialQ?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQ || searchParams.get("q") || "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2 sm:gap-3"
    >
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Search
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tags, captions, or file name…"
          className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />
      </label>
      <button
        type="submit"
        className="h-10 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
      >
        Search
      </button>
    </form>
  );
}
