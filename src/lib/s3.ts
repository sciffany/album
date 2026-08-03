import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

let client: S3Client | null = null;

type StorageProvider = "s3" | "b2";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getStorageProvider(): StorageProvider {
  const raw = (process.env.STORAGE_PROVIDER ?? "s3").trim().toLowerCase();
  if (raw === "s3" || raw === "b2") return raw;
  throw new Error(`Invalid STORAGE_PROVIDER "${raw}" (expected "s3" or "b2")`);
}

/** B2 S3-compatible endpoint, or any custom S3_ENDPOINT override. */
function getEndpoint(provider: StorageProvider, region: string): string | undefined {
  const explicit = process.env.S3_ENDPOINT?.trim();
  if (explicit) return explicit;
  if (provider === "b2") {
    return `https://s3.${region}.backblazeb2.com`;
  }
  return undefined;
}

function getClient() {
  const provider = getStorageProvider();
  const region = requireEnv("AWS_REGION");
  const accessKeyId = requireEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("AWS_SECRET_ACCESS_KEY");
  const endpoint = getEndpoint(provider, region);

  if (!client) {
    client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint
        ? {
            endpoint,
            // Required for B2 and most S3-compatible providers.
            forcePathStyle: true,
          }
        : {}),
    });
  }
  return client;
}

export function getBucket(): string {
  return requireEnv("S3_BUCKET");
}

export async function presignGetObject(
  bucket: string,
  key: string,
  expiresIn = 60 * 60,
  opts?: { downloadFileName?: string },
) {
  const fileName = opts?.downloadFileName?.trim();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(fileName
      ? {
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "_")}"`,
        }
      : {}),
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function presignPutObject(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn = 60 * 15,
) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

/** Put object bytes (or an empty folder-marker object). */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string = new Uint8Array(),
  contentType?: string,
): Promise<void> {
  const bucket = getBucket();
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  );
}

export type S3Folder = {
  name: string;
  path: string;
};

export type S3Object = {
  key: string;
  lastModified: Date | null;
  size: number;
};

export type S3PrefixListing = {
  folders: S3Folder[];
  objects: S3Object[];
};

function normalizePrefix(path: string): string {
  if (!path) return "";
  return path.endsWith("/") ? path : `${path}/`;
}

/** List immediate child folders and objects under an S3 prefix (Delimiter=/). */
export async function listPrefix(path: string): Promise<S3PrefixListing> {
  const bucket = getBucket();
  const prefix = normalizePrefix(path);
  const folders: S3Folder[] = [];
  const objects: S3Object[] = [];
  let token: string | undefined;

  do {
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: "/",
        ContinuationToken: token,
      }),
    );

    for (const cp of res.CommonPrefixes ?? []) {
      if (!cp.Prefix) continue;
      const folderPath = cp.Prefix.replace(/\/$/, "");
      const name = folderPath.split("/").pop() || folderPath;
      folders.push({ name, path: folderPath });
    }

    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue;
      // Skip the prefix "folder marker" itself when present as a zero-byte key.
      if (prefix && obj.Key === prefix) continue;
      objects.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? null,
        size: obj.Size ?? 0,
      });
    }

    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  folders.sort((a, b) => a.name.localeCompare(b.name));
  objects.sort((a, b) => {
    const at = a.lastModified?.getTime() ?? 0;
    const bt = b.lastModified?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.key.localeCompare(b.key);
  });

  return { folders, objects };
}

/**
 * True if the prefix exists (any key under it, including a folder marker).
 * Uses MaxKeys=1 — do not call this before listPrefix on the same path;
 * list first and only probe when the listing is empty.
 */
export async function prefixExists(path: string): Promise<boolean> {
  if (!path) return true;
  const bucket = getBucket();
  const prefix = normalizePrefix(path);

  const res = await getClient().send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1,
    }),
  );

  return (res.Contents?.length ?? 0) > 0;
}

/** List every object under an optional prefix (no delimiter — recursive). */
export async function listAllObjects(
  path = "",
  opts?: { includeMarkers?: boolean },
): Promise<S3Object[]> {
  const bucket = getBucket();
  const prefix = path ? normalizePrefix(path) : "";
  const includeMarkers = opts?.includeMarkers ?? false;
  const objects: S3Object[] = [];
  let token: string | undefined;

  do {
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }),
    );

    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      const isMarker = obj.Key.endsWith("/");
      if (isMarker && !includeMarkers) continue;
      if (!includeMarkers && prefix && obj.Key === prefix) continue;
      objects.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? null,
        size: obj.Size ?? 0,
      });
    }

    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return objects;
}

async function bodyToBuffer(
  body: { transformToByteArray?: () => Promise<Uint8Array> } | undefined,
): Promise<Buffer> {
  if (!body?.transformToByteArray) {
    throw new Error("S3 GetObject response missing body");
  }
  return Buffer.from(await body.transformToByteArray());
}

/**
 * Download object bytes. Pass `byteLength` to fetch only the leading range
 * (useful for EXIF, which usually lives near the start of the file).
 */
export async function getObjectBytes(
  key: string,
  opts?: { byteLength?: number },
): Promise<Buffer> {
  const bucket = getBucket();
  const range =
    opts?.byteLength && opts.byteLength > 0
      ? `bytes=0-${opts.byteLength - 1}`
      : undefined;

  const res = await getClient().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: range,
    }),
  );

  return bodyToBuffer(res.Body);
}

/** Stream an object body (Node Readable) for piping into zip archives, etc. */
export async function getObjectReadable(key: string): Promise<Readable> {
  const bucket = getBucket();
  const res = await getClient().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  if (!res.Body) {
    throw new Error("S3 GetObject response missing body");
  }
  return res.Body as Readable;
}

export async function objectExists(key: string): Promise<boolean> {
  const bucket = getBucket();
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    const name = (err as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      return false;
    }
    throw err;
  }
}

export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  const bucket = getBucket();
  const encodedKey = fromKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  await getClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodedKey}`,
      Key: toKey,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  const bucket = getBucket();
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}

/**
 * S3 has no rename — copy then delete source.
 * Caller is responsible for updating any DB references between copy and delete.
 */
export async function moveObject(fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  await copyObject(fromKey, toKey);
  await deleteObject(fromKey);
}
