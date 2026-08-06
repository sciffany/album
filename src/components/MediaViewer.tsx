"use client";

import { useEffect, useRef } from "react";
import { extFromKey } from "@/lib/media-types";

export function MediaViewer({
  open,
  onClose,
  src,
  name,
  caption,
  mediaType,
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  name: string;
  caption: string | null;
  mediaType: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isVideo = mediaType === "video";
  const isFile = mediaType === "file";
  const label = caption || name;
  const ext = extFromKey(name);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          {caption && (
            <p className="truncate text-xs text-white/70">{caption}</p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10 hover:text-white"
        >
          Close
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {isFile ? (
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-lg bg-white/10 px-8 py-10 text-center text-white">
            <svg
              viewBox="0 0 24 24"
              className="h-14 w-14 text-white/80"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
            </svg>
            <div>
              <p className="text-sm font-medium">{name}</p>
              <p className="mt-1 text-xs text-white/60">
                {ext ? `.${ext} file` : "File"} — no in-browser preview
              </p>
            </div>
            <a
              href={src}
              download={name}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Download
            </a>
          </div>
        ) : isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={src}
            src={src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="max-h-full max-w-full rounded-md bg-black shadow-lg outline-none"
          >
            Your browser cannot play this video. Use Download to save it.
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={label}
            className="max-h-full max-w-full rounded-md object-contain shadow-lg"
          />
        )}
      </div>
    </div>
  );
}
