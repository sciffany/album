import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getObjectBytes } from "@/lib/s3";
import { assertValidFolderPath } from "@/lib/storage-keys";
import { findOrCreateTags } from "@/lib/tags";
import { slugifyTag } from "@/lib/tag-slug";

/** Preferred model first. Gemini 3.8 Flash often returns 503 while 3.6 Flash still answers. */
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"] as const;
/** After a model says it is overloaded, skip it so the rest of the folder does not spend quota on failures. */
const MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_EDGE = 1024;
const MAX_TAGS = 8;
const MAX_CAPTION = 400;

const PHOTO_EXTS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
  "bmp",
] as const;

const PROMPT = `You label photos in a personal library. Look at this image and describe only what is visible.

Return JSON with:
- caption: one short sentence
- tags: 4 to 8 short lowercase labels for the scene, objects, place type, or activity

Generic labels such as "person" or "portrait" are fine. Do not guess anyone's name. Do not include hashtags or punctuation in tags.`;

export type TagNextPhotoResult =
  | { done: true }
  | {
      done: false;
      name: string;
      /** 1 when a caption was saved, 0 when the file was skipped. */
      tagged: number;
      /** Untagged photos still left in this folder after this step. */
      remaining: number;
    };

function untaggedPhotoWhere(path: string): Prisma.MediaWhereInput {
  const photoName: Prisma.MediaWhereInput = {
    AND: [
      { NOT: { name: { startsWith: "." } } },
      {
        OR: PHOTO_EXTS.map((ext) => ({
          name: { endsWith: `.${ext}`, mode: "insensitive" as const },
        })),
      },
    ],
  };

  const folderScope: Prisma.MediaWhereInput = path
    ? {
        folder: {
          deletedAt: null,
          OR: [{ path }, { path: { startsWith: `${path}/` } }],
        },
      }
    : {
        OR: [{ folderId: null }, { folder: { is: { deletedAt: null } } }],
      };

  return {
    deletedAt: null,
    aiCaption: null,
    AND: [photoName, folderScope],
  };
}

function normalizeCaption(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.slice(0, MAX_CAPTION);
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item
      .trim()
      .toLowerCase()
      .replace(/[#.,!?;:'"]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 40);
    if (!text || text.split(" ").length > 4) continue;
    const slug = slugifyTag(text);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    tags.push(text);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function parseModelJson(text: string): { caption: string; tags: string[] } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: { caption?: unknown; tags?: unknown };
  try {
    value = JSON.parse(trimmed) as { caption?: unknown; tags?: unknown };
  } catch {
    throw new Error("The model returned an unreadable description");
  }
  const caption = normalizeCaption(value.caption);
  if (!caption) throw new Error("The model did not return a caption");
  return { caption, tags: normalizeTags(value.tags) };
}

function isMissingObject(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

/** A missing decoder would skip every photo of that type, so stop instead. */
function isUnsupportedCodec(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("no decoding plugin") ||
    message.includes("unsupported image format")
  );
}

async function resizeForTagging(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    if (isUnsupportedCodec(err)) throw err;
    throw new UnreadablePhotoError();
  }
}

class UnreadablePhotoError extends Error {
  constructor() {
    super("Could not read this photo");
    this.name = "UnreadablePhotoError";
  }
}

/** Busy or rate-limited model. The caller should try the next model. */
class GeminiUnavailableError extends Error {
  readonly limit: boolean;

  constructor(message: string, limit: boolean) {
    super(message);
    this.name = "GeminiUnavailableError";
    this.limit = limit;
  }
}

const modelReadyAt = new Map<string, number>();
let sawBusyModel = false;
let sawRateLimit = false;

function unavailableMessage(): string {
  if (sawRateLimit && !sawBusyModel) {
    return "Gemini rate limit reached. Wait and try again.";
  }
  return "Gemini is busy right now. Wait a minute and try again.";
}

function modelCoolingDown(model: string): boolean {
  return (modelReadyAt.get(model) ?? 0) > Date.now();
}

function coolDownModel(model: string) {
  modelReadyAt.set(model, Date.now() + MODEL_COOLDOWN_MS);
}

type GeminiBody = {
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
};

function geminiErrorMessage(body: GeminiBody | null, status: number): string {
  return body?.error?.message?.trim() || `Gemini request failed (${status})`;
}

function shouldTryNextModel(
  status: number,
  body: GeminiBody | null,
  message: string,
): boolean {
  if (status === 429 || status === 503) return true;
  const errorStatus = body?.error?.status;
  if (errorStatus === "UNAVAILABLE" || errorStatus === "RESOURCE_EXHAUSTED") {
    return true;
  }
  return /high demand|overloaded|try again later/i.test(message);
}

async function describeWithModel(
  apiKey: string,
  model: string,
  jpeg: Buffer,
): Promise<{ caption: string; tags: string[] }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: jpeg.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: "LOW" },
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              caption: { type: "STRING" },
              tags: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["caption", "tags"],
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  const body = (await res.json().catch(() => null)) as GeminiBody | null;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Gemini API key was rejected");
    }
    const detail = geminiErrorMessage(body, res.status);
    if (shouldTryNextModel(res.status, body, detail)) {
      coolDownModel(model);
      const limit =
        res.status === 429 || body?.error?.status === "RESOURCE_EXHAUSTED";
      throw new GeminiUnavailableError(detail, limit);
    }
    throw new Error(`Gemini could not tag this photo: ${detail}`);
  }

  const blocked = body?.promptFeedback?.blockReason;
  if (blocked) {
    throw new Error("Gemini declined to describe this photo");
  }

  const text = body?.candidates?.[0]?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new Error("Gemini returned an empty description");
  }
  return parseModelJson(text);
}

async function describePhoto(jpeg: Buffer): Promise<{
  caption: string;
  tags: string[];
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set GEMINI_API_KEY to tag photos");
  }

  const models = GEMINI_MODELS.filter((model) => !modelCoolingDown(model));
  if (models.length === 0) {
    throw new Error(unavailableMessage());
  }

  for (const model of models) {
    try {
      return await describeWithModel(apiKey, model, jpeg);
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        if (err.limit) sawRateLimit = true;
        else sawBusyModel = true;
        continue;
      }
      if (
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        coolDownModel(model);
        sawBusyModel = true;
        continue;
      }
      throw err;
    }
  }

  throw new Error(unavailableMessage());
}

async function writePhotoTags(
  mediaId: string,
  caption: string,
  tagTexts: string[],
) {
  const tagRows = await findOrCreateTags(tagTexts);
  const existing =
    tagRows.length === 0
      ? []
      : await prisma.mediaTag.findMany({
          where: {
            mediaId,
            tagId: { in: tagRows.map((tag) => tag.id) },
          },
          select: { tagId: true },
        });
  const have = new Set(existing.map((row) => row.tagId));
  const toCreate = tagRows.filter((tag) => !have.has(tag.id));

  await prisma.$transaction([
    prisma.media.update({
      where: { id: mediaId },
      data: { aiCaption: caption },
    }),
    ...(toCreate.length > 0
      ? [
          prisma.mediaTag.createMany({
            data: toCreate.map((tag) => ({
              mediaId,
              tagId: tag.id,
              source: "ai",
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/**
 * Tag the next photo in a folder (and nested folders) that has no AI caption.
 * One photo per call so a large folder does not hold a single request open.
 */
export async function tagNextUntaggedPhoto(
  folderPath: string,
): Promise<TagNextPhotoResult> {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("Set GEMINI_API_KEY to tag photos");
  }

  const path = assertValidFolderPath(folderPath || "", "folder path");
  if (path) {
    const folder = await prisma.folder.findFirst({
      where: { path, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new Error("Folder not found");
  }

  const where = untaggedPhotoWhere(path);
  const photo = await prisma.media.findFirst({
    where,
    select: { id: true, name: true, s3Key: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (!photo) return { done: true };

  let skipped = false;
  try {
    const bytes = await getObjectBytes(photo.s3Key);
    const jpeg = await resizeForTagging(bytes);
    if (jpeg.length === 0) throw new UnreadablePhotoError();
    const described = await describePhoto(jpeg);
    await writePhotoTags(photo.id, described.caption, described.tags);
  } catch (err) {
    if (err instanceof UnreadablePhotoError || isMissingObject(err)) {
      skipped = true;
      // Empty caption marks the file done so one bad photo does not block the folder.
      await prisma.media.update({
        where: { id: photo.id },
        data: { aiCaption: "" },
      });
    } else {
      throw err;
    }
  }

  const remaining = await prisma.media.count({ where });
  return {
    done: false,
    name: photo.name,
    tagged: skipped ? 0 : 1,
    remaining,
  };
}
