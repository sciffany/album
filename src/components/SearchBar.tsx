"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function SearchBar({
  initialQ = "",
  initialFrom = "",
  initialTo = "",
}: {
  initialQ?: string;
  initialFrom?: string;
  initialTo?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQ || searchParams.get("q") || "");
  const [from, setFrom] = useState(
    initialFrom || searchParams.get("from") || "",
  );
  const [to, setTo] = useState(initialTo || searchParams.get("to") || "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
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
          placeholder="Tags or captions…"
          className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          From
        </span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          To
        </span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
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
