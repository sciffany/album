/** Hamming distance at or below this counts as visually close. */
export const DHASH_MAX_DISTANCE = 10;

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/** Long edge used when measuring sharpness and eye aspect ratio. */
export const ANALYSIS_MAX_EDGE = 512;

/** Unsigned 32-bit pair: low 32 bits, then high 32 bits. */
export type DHash = readonly [number, number];

export type Point2 = { x: number; y: number };

export type PhotoQuality = {
  sharpness: number;
  /** Null when no face was found. */
  ear: number | null;
};

const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;

function popcount(n: number): number {
  let x = n >>> 0;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

export function hammingDistance(a: DHash, b: DHash): number {
  return popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);
}

function toGray(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function grayscaleFromRgba(rgba: Uint8ClampedArray): Uint8Array {
  const count = rgba.length / 4;
  const gray = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    gray[i] = toGray(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
  }
  return gray;
}

/**
 * 64-bit dHash. `rgba` is a DHASH_WIDTH × DHASH_HEIGHT image.
 * Each bit is 1 when the left pixel is brighter than the pixel to its right.
 */
export function dhashFromRgba(rgba: Uint8ClampedArray): DHash {
  const width = DHASH_WIDTH;
  const height = DHASH_HEIGHT;
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `dHash expects ${width}×${height} RGBA (${width * height * 4} bytes)`,
    );
  }

  const gray = grayscaleFromRgba(rgba);
  let lo = 0;
  let hi = 0;
  let bit = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width - 1; x++) {
      if (gray[row + x] > gray[row + x + 1]) {
        if (bit < 32) lo = (lo | (1 << bit)) >>> 0;
        else hi = (hi | (1 << (bit - 32))) >>> 0;
      }
      bit++;
    }
  }
  return [lo, hi];
}

/**
 * Chain consecutive hashes into groups. A null hash is an unreadable photo:
 * it is not a member, and it splits its neighbors so they are not consecutive.
 * Groups of one are dropped.
 */
export function groupConsecutiveHashes(
  hashes: readonly (DHash | null)[],
  maxDistance = DHASH_MAX_DISTANCE,
): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];

  function closeCurrent() {
    if (current.length >= 2) groups.push(current);
    current = [];
  }

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (hash == null) {
      closeCurrent();
      continue;
    }
    if (current.length === 0) {
      current = [i];
      continue;
    }
    const prev = hashes[current[current.length - 1]!];
    if (prev && hammingDistance(prev, hash) <= maxDistance) {
      current.push(i);
    } else {
      closeCurrent();
      current = [i];
    }
  }
  closeCurrent();
  return groups;
}

/** Variance of a 4-neighbor Laplacian over grayscale pixels. Higher is sharper. */
export function laplacianVariance(
  gray: Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3 || gray.length !== width * height) return 0;

  let count = 0;
  let sum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      sum +=
        gray[i - width] +
        gray[i - 1] -
        4 * gray[i] +
        gray[i + 1] +
        gray[i + width];
      count++;
    }
  }
  if (count === 0) return 0;

  const mean = sum / count;
  let variance = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        gray[i - width] +
        gray[i - 1] -
        4 * gray[i] +
        gray[i + 1] +
        gray[i + width];
      const delta = value - mean;
      variance += delta * delta;
    }
  }
  return variance / count;
}

function distance(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function eyeRatio(
  landmarks: readonly Point2[],
  ids: readonly number[],
): number | null {
  const points = ids.map((id) => landmarks[id]);
  if (points.some((point) => !point)) return null;
  const [p1, p2, p3, p4, p5, p6] = points as [
    Point2,
    Point2,
    Point2,
    Point2,
    Point2,
    Point2,
  ];
  const horizontal = distance(p1, p4);
  if (horizontal < 1e-6) return null;
  return (distance(p2, p6) + distance(p3, p5)) / (2 * horizontal);
}

/**
 * Minimum eye-aspect ratio across faces. A blink on any face lowers the score.
 * Returns null when no usable eyes were found.
 */
export function eyeAspectRatio(faces: readonly (readonly Point2[])[]): number | null {
  let min: number | null = null;
  for (const face of faces) {
    const left = eyeRatio(face, LEFT_EYE);
    const right = eyeRatio(face, RIGHT_EYE);
    const samples = [left, right].filter((value): value is number => value != null);
    if (!samples.length) continue;
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    if (min == null || average < min) min = average;
  }
  return min;
}

function minMax(values: readonly number[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  if (!Number.isFinite(span) || span === 0) return values.map(() => 1);
  return values.map((value) => (value - min) / span);
}

/**
 * Index of the photo to keep. Sharpness and EAR are min-max normalized inside
 * the group and added with equal weight. Missing EAR counts as 0 when any
 * photo has a face; otherwise EAR is ignored. Ties prefer higher sharpness,
 * then the earlier photo.
 */
export function recommendKeepIndex(items: readonly PhotoQuality[]): number {
  if (items.length === 0) return 0;

  const anyFace = items.some((item) => item.ear != null);
  const sharpnessNorm = minMax(items.map((item) => item.sharpness));
  const earNorm = anyFace
    ? minMax(items.map((item) => item.ear ?? 0))
    : null;

  let best = 0;
  let bestScore = -Infinity;
  let bestSharpness = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const score = sharpnessNorm[i] + (earNorm ? earNorm[i] : 0);
    const sharpness = items[i].sharpness;
    if (score > bestScore || (score === bestScore && sharpness > bestSharpness)) {
      best = i;
      bestScore = score;
      bestSharpness = sharpness;
    }
  }
  return best;
}
