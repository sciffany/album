"use client";

import { useEffect, useRef } from "react";

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
  const label = caption || name;

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
        {isVideo ? (
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
