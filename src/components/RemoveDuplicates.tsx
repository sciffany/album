"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { softDeleteMediaAction } from "@/lib/actions";
import {
  ANALYSIS_MAX_EDGE,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  dhashFromRgba,
  eyeAspectRatio,
  grayscaleFromRgba,
  groupConsecutiveHashes,
  laplacianVariance,
  recommendKeepIndex,
  type DHash,
  type PhotoQuality,
} from "@/lib/image-similarity";
import { extFromKey } from "@/lib/media-types";

export type FolderPhoto = {
  id: string;
  name: string;
  s3Key: string;
  datetimeTaken: string | null;
};

type ScoredPhoto = FolderPhoto & {
  sharpness: number;
  ear: number | null;
};

type ScoredGroup = {
  photos: ScoredPhoto[];
  recommendedId: string;
};

type ReviewOverlay = {
  kind: "review";
  groups: ScoredGroup[];
  index: number;
  keptIds: string[];
  skipped: number;
  facesSkipped: boolean;
  error: string | null;
  deleting: boolean;
};

type Overlay =
  | { kind: "empty"; skipped: number }
  | { kind: "error"; message: string }
  | ReviewOverlay;

const UNREADABLE_EXT = new Set(["heic", "heif", "tif", "tiff"]);

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function formatSharpness(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 100) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(1);
}

function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function analysisSize(width: number, height: number) {
  const longEdge = Math.max(width, height);
  if (longEdge <= ANALYSIS_MAX_EDGE) {
    return { width: Math.max(3, width), height: Math.max(3, height) };
  }
  const scale = ANALYSIS_MAX_EDGE / longEdge;
  return {
    width: Math.max(3, Math.round(width * scale)),
    height: Math.max(3, Math.round(height * scale)),
  };
}

function drawBitmap(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx };
}

async function loadBitmap(s3Key: string, signal: AbortSignal) {
  const res = await fetch(
    `/api/s3/object?key=${encodeURIComponent(s3Key)}&stream=1`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`Could not load image (${res.status})`);
  }
  const blob = await res.blob();
  throwIfAborted(signal);
  return createImageBitmap(blob);
}

function supportsOffscreenCanvas() {
  if (typeof OffscreenCanvas === "undefined") return false;
  const ua = navigator.userAgent;
  const safari =
    ua.includes("Safari") && !ua.includes("Chrome") && !ua.includes("Chromium");
  if (!safari) return true;
  const version = ua.match(/Version\/(\d+)/);
  return version != null && Number(version[1]) >= 17;
}

/**
 * MediaPipe's WASM build wraps `getContext` with a Safari check that drops
 * WebGL2 contexts on browsers where `WebGL2RenderingContext` extends
 * `WebGLRenderingContext`. Detection then crashes reading `activeTexture`.
 * This wrapper keeps a WebGL2 context when one was requested, and the
 * `getContextSafariWebGL2Fixed` flag tells that loader to leave the canvas alone.
 */
function createVisionCanvas(): HTMLCanvasElement | OffscreenCanvas {
  const canvas: HTMLCanvasElement | OffscreenCanvas = supportsOffscreenCanvas()
    ? new OffscreenCanvas(1, 1)
    : Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  const patched = canvas as HTMLCanvasElement & {
    getContextSafariWebGL2Fixed?: HTMLCanvasElement["getContext"];
  };
  const original = canvas.getContext.bind(canvas) as (
    type: string,
    attrs?: CanvasRenderingContext2DSettings,
  ) => RenderingContext | null;

  patched.getContextSafariWebGL2Fixed =
    original as HTMLCanvasElement["getContext"];
  patched.getContext = function (
    type: string,
    attrs?: CanvasRenderingContext2DSettings,
  ) {
    const gl = original(type, attrs);
    if (!gl) return null;
    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;
    if ((type === "webgl") === isWebGL2) return null;
    return gl;
  } as HTMLCanvasElement["getContext"];
  return canvas;
}

function probeFaceLandmarker(landmarker: FaceLandmarker) {
  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  landmarker.detect(probe);
}

async function openFaceLandmarker(
  signal: AbortSignal,
): Promise<FaceLandmarker | null> {
  throwIfAborted(signal);
  const { FaceLandmarker, FilesetResolver } = await import(
    "@mediapipe/tasks-vision"
  );
  throwIfAborted(signal);
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  throwIfAborted(signal);

  for (const delegate of ["GPU", "CPU"] as const) {
    throwIfAborted(signal);
    let landmarker: FaceLandmarker | null = null;
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        runningMode: "IMAGE",
        numFaces: 8,
        canvas: createVisionCanvas(),
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      });
      throwIfAborted(signal);
      probeFaceLandmarker(landmarker);
      return landmarker;
    } catch (err) {
      try {
        landmarker?.close();
      } catch {
        // The context is already unusable.
      }
      if (isAbortError(err)) throw err;
      console.error(`Face detection (${delegate}) failed`, err);
    }
  }
  return null;
}

function DialogFrame({
  titleId,
  title,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto p-4">
          <h2
            id={titleId}
            className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
          >
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>
  );
}

export function RemoveDuplicates({
  photos,
  disabled = false,
  onBusyChange,
}: {
  photos: FolderPhoto[];
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lockRef = useRef(false);
  const deletedAny = useRef(false);

  const flowActive = progress !== null || overlay !== null;

  useEffect(() => {
    onBusyChange?.(flowActive);
  }, [flowActive, onBusyChange]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  function closeOverlay() {
    if (overlay?.kind === "review" && overlay.deleting) return;
    abortRef.current?.abort();
    const refresh = deletedAny.current;
    deletedAny.current = false;
    setOverlay(null);
    setProgress(null);
    if (refresh) router.refresh();
  }

  function cancelScan() {
    abortRef.current?.abort();
  }

  function goToGroup(current: ReviewOverlay, nextIndex: number) {
    if (nextIndex >= current.groups.length) {
      deletedAny.current = false;
      setOverlay(null);
      setProgress(null);
      router.refresh();
      return;
    }
    const next = current.groups[nextIndex];
    setOverlay({
      ...current,
      index: nextIndex,
      keptIds: [next.recommendedId],
      error: null,
      deleting: false,
    });
  }

  function skipGroup() {
    if (overlay?.kind !== "review" || overlay.deleting) return;
    goToGroup(overlay, overlay.index + 1);
  }

  function toggleKeep(id: string) {
    setOverlay((current) => {
      if (current?.kind !== "review" || current.deleting) return current;
      const has = current.keptIds.includes(id);
      if (has && current.keptIds.length === 1) return current;
      return {
        ...current,
        keptIds: has
          ? current.keptIds.filter((keptId) => keptId !== id)
          : [...current.keptIds, id],
      };
    });
  }

  async function deleteRest() {
    if (overlay?.kind !== "review" || overlay.deleting) return;
    const current = overlay;
    const group = current.groups[current.index];
    if (!group) return;
    const kept = new Set(current.keptIds);
    if (kept.size === 0) return;
    const victims = group.photos.filter((photo) => !kept.has(photo.id));
    if (victims.length === 0) {
      goToGroup(current, current.index + 1);
      return;
    }

    setOverlay({ ...current, deleting: true, error: null });

    const failed: ScoredPhoto[] = [];
    const deletedIds = new Set<string>();
    for (const photo of victims) {
      try {
        const result = await softDeleteMediaAction(photo.s3Key);
        if (!result.ok) failed.push(photo);
        else deletedIds.add(photo.id);
      } catch {
        failed.push(photo);
      }
    }

    if (deletedIds.size > 0) deletedAny.current = true;

    if (failed.length > 0) {
      const groups = current.groups.slice();
      groups[current.index] = {
        ...group,
        photos: group.photos.filter((photo) => !deletedIds.has(photo.id)),
      };
      setOverlay({
        ...current,
        groups,
        deleting: false,
        error: `Could not delete ${failed.map((photo) => photo.name).join(", ")}`,
      });
      return;
    }

    goToGroup(current, current.index + 1);
  }

  async function start() {
    if (lockRef.current || disabled || photos.length < 2 || flowActive) return;
    lockRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    deletedAny.current = false;
    setOverlay(null);
    setProgress(`Comparing 1 / ${photos.length}…`);

    let landmarker: FaceLandmarker | null = null;
    try {
      const hashes: (DHash | null)[] = [];
      let skipped = 0;

      for (let i = 0; i < photos.length; i++) {
        throwIfAborted(controller.signal);
        setProgress(`Comparing ${i + 1} / ${photos.length}…`);
        const photo = photos[i];
        if (UNREADABLE_EXT.has(extFromKey(photo.name))) {
          hashes.push(null);
          skipped++;
          continue;
        }

        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await loadBitmap(photo.s3Key, controller.signal);
          const { ctx } = drawBitmap(bitmap, DHASH_WIDTH, DHASH_HEIGHT);
          const pixels = ctx.getImageData(0, 0, DHASH_WIDTH, DHASH_HEIGHT);
          hashes.push(dhashFromRgba(pixels.data));
        } catch (err) {
          if (isAbortError(err)) throw err;
          hashes.push(null);
          skipped++;
        } finally {
          bitmap?.close();
        }
      }

      throwIfAborted(controller.signal);
      const indexGroups = groupConsecutiveHashes(hashes);
      if (indexGroups.length === 0) {
        setOverlay({ kind: "empty", skipped });
        return;
      }

      const scoreTotal = indexGroups.reduce((sum, group) => sum + group.length, 0);
      setProgress(`Scoring 1 / ${scoreTotal}…`);
      landmarker = await openFaceLandmarker(controller.signal);
      throwIfAborted(controller.signal);
      let facesSkipped = landmarker == null;

      const groups: ScoredGroup[] = [];
      let scored = 0;
      for (const indexes of indexGroups) {
        const qualities: PhotoQuality[] = [];
        const members: ScoredPhoto[] = [];
        for (const index of indexes) {
          throwIfAborted(controller.signal);
          scored++;
          setProgress(`Scoring ${scored} / ${scoreTotal}…`);
          const photo = photos[index];
          const bitmap = await loadBitmap(photo.s3Key, controller.signal);
          try {
            const size = analysisSize(bitmap.width, bitmap.height);
            const { canvas, ctx } = drawBitmap(bitmap, size.width, size.height);
            const pixels = ctx.getImageData(0, 0, size.width, size.height);
            const sharpness = laplacianVariance(
              grayscaleFromRgba(pixels.data),
              size.width,
              size.height,
            );
            let ear: number | null = null;
            if (landmarker) {
              try {
                ear = eyeAspectRatio(landmarker.detect(canvas).faceLandmarks);
              } catch (err) {
                if (isAbortError(err)) throw err;
                console.error("Face detection failed", err);
                try {
                  landmarker.close();
                } catch {
                  // The context is already unusable.
                }
                landmarker = null;
                facesSkipped = true;
              }
            }
            qualities.push({ sharpness, ear });
            members.push({ ...photo, sharpness, ear });
          } finally {
            bitmap.close();
          }
        }
        const keepAt = recommendKeepIndex(qualities);
        const chosen = members[keepAt];
        if (!chosen) throw new Error("Could not score this group");
        groups.push({
          photos: members,
          recommendedId: chosen.id,
        });
      }

      const first = groups[0];
      if (!first) {
        setOverlay({ kind: "empty", skipped });
        return;
      }
      setOverlay({
        kind: "review",
        groups,
        index: 0,
        keptIds: [first.recommendedId],
        skipped,
        facesSkipped,
        error: null,
        deleting: false,
      });
    } catch (err) {
      if (!isAbortError(err)) {
        setOverlay({
          kind: "error",
          message:
            err instanceof Error && err.message
              ? err.message
              : "Could not compare photos",
        });
      }
    } finally {
      try {
        landmarker?.close();
      } catch (err) {
        console.error("Could not close face detection", err);
      }
      setProgress(null);
      lockRef.current = false;
    }
  }

  const review = overlay?.kind === "review" ? overlay : null;
  const group = review ? review.groups[review.index] : null;
  const deleteCount =
    review && group
      ? group.photos.filter((photo) => !review.keptIds.includes(photo.id))
          .length
      : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void start();
        }}
        disabled={disabled || photos.length < 2 || flowActive}
        title={
          photos.length < 2
            ? "This folder needs at least two photos"
            : "Find visually similar photos in this folder"
        }
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
      >
        Remove duplicates
      </button>
      {progress && (
        <>
          <span className="text-xs text-[var(--muted)]" aria-live="polite">
            {progress}
          </span>
          <button
            type="button"
            onClick={cancelScan}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
        </>
      )}

      {overlay?.kind === "empty" && (
        <DialogFrame
          titleId="duplicates-empty-title"
          title="No similar photos"
          onClose={closeOverlay}
        >
          <p className="mt-2 text-sm text-[var(--muted)]">
            No similar photos in this folder.
          </p>
          {overlay.skipped > 0 && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Skipped {overlay.skipped}{" "}
              {overlay.skipped === 1 ? "photo" : "photos"} the browser could
              not read.
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={closeOverlay}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)]"
            >
              OK
            </button>
          </div>
        </DialogFrame>
      )}

      {overlay?.kind === "error" && (
        <DialogFrame
          titleId="duplicates-error-title"
          title="Could not compare photos"
          onClose={closeOverlay}
        >
          <p className="mt-2 text-sm text-red-700">{overlay.message}</p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={closeOverlay}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
            >
              Close
            </button>
          </div>
        </DialogFrame>
      )}

      {review && group && (
        <DialogFrame
          titleId="duplicates-review-title"
          title={`Similar photos (${review.index + 1} of ${review.groups.length})`}
          onClose={closeOverlay}
        >
              <p className="mt-1 text-sm text-[var(--muted)]">
                The recommended photo scores highest for sharpness and open
                eyes. You can keep more than one. Unchecked photos go to the
                recycle bin.
              </p>
              {review.skipped > 0 && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Skipped {review.skipped}{" "}
                  {review.skipped === 1 ? "photo" : "photos"} the browser could
                  not read.
                </p>
              )}
              {review.facesSkipped && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Could not check for closed eyes, so the recommendation uses
                  sharpness only.
                </p>
              )}
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {group.photos.map((photo) => {
                  const kept = review.keptIds.includes(photo.id);
                  const recommended = photo.id === group.recommendedId;
                  const dateLabel = formatDate(photo.datetimeTaken);
                  return (
                    <li key={photo.id}>
                      <label
                        className={`block cursor-pointer overflow-hidden rounded-md border bg-[var(--surface)] ${
                          kept
                            ? "border-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <span className="relative block aspect-square bg-[var(--surface-2)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/s3/object?key=${encodeURIComponent(photo.s3Key)}`}
                            alt={photo.name}
                            className="h-full w-full object-cover"
                          />
                          {recommended && (
                            <span className="absolute left-2 top-2 rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                              Recommended
                            </span>
                          )}
                        </span>
                        <span className="block space-y-0.5 p-2">
                          <span className="block truncate text-sm text-[var(--ink)]">
                            {photo.name}
                          </span>
                          {dateLabel && (
                            <span className="block text-xs text-[var(--muted)]">
                              {dateLabel}
                            </span>
                          )}
                          <span className="block text-xs text-[var(--muted)]">
                            Sharpness {formatSharpness(photo.sharpness)}
                          </span>
                          <span className="block text-xs text-[var(--muted)]">
                            {photo.ear == null
                              ? "No face"
                              : `EAR ${photo.ear.toFixed(3)}`}
                          </span>
                          <span className="mt-2 flex items-center gap-2 text-sm text-[var(--ink)]">
                            <input
                              type="checkbox"
                              checked={kept}
                              disabled={review.deleting}
                              onChange={() => toggleKeep(photo.id)}
                            />
                            Keep
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {review.error && (
                <p className="mt-3 text-xs text-red-700">{review.error}</p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeOverlay}
                  disabled={review.deleting}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={skipGroup}
                  disabled={review.deleting}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
                >
                  Skip group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteRest();
                  }}
                  disabled={review.deleting || review.keptIds.length === 0}
                  className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50 ${
                    deleteCount === 0
                      ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                      : "bg-red-800 hover:bg-red-900"
                  }`}
                >
                  {review.deleting
                    ? "Deleting…"
                    : deleteCount === 0
                      ? "Keep all"
                      : "Delete the rest"}
                </button>
              </div>
        </DialogFrame>
      )}
    </>
  );
}
