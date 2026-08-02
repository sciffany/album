import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn });
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

/** True if the prefix has any children (folders or objects). Root always exists. */
export async function prefixExists(path: string): Promise<boolean> {
  if (!path) return true;
  const { folders, objects } = await listPrefix(path);
  if (folders.length > 0 || objects.length > 0) return true;

  // Empty leaf prefix: check whether parent lists this name as a common prefix.
  const parts = path.split("/");
  const name = parts.pop()!;
  const parent = parts.join("/");
  const parentListing = await listPrefix(parent);
  return parentListing.folders.some((f) => f.name === name);
}
