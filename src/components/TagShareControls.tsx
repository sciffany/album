"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import {
  createOrGetTagShareAction,
  getTagShareAction,
  revokeTagShareAction,
} from "@/lib/actions";

export function TagShareControls({
  slug,
}: {
  slug: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hasShare, setHasShare] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTagShareAction(slug).then((result) => {
      if (cancelled || !result.ok) return;
      setHasShare(Boolean(result.url));
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!slug) return null;

  const btn =
    "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50";

  function onCopy(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await createOrGetTagShareAction(slug);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await navigator.clipboard.writeText(result.url);
        setHasShare(true);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not copy share link",
        );
      }
    });
  }

  function onRevoke(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Revoke the share link? Anyone with the URL will lose access.")) {
      return;
    }
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await revokeTagShareAction(slug);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setHasShare(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not revoke share link",
        );
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        disabled={pending}
        className={btn}
      >
        {pending ? "Working…" : copied ? "Copied!" : "Copy share link"}
      </button>
      {hasShare && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={pending}
          className={btn}
        >
          Revoke share
        </button>
      )}
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
