import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

function getClient() {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
  }
  if (!client) {
    client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

/** Parse virtual-hosted–style S3 HTTPS URLs into bucket + key. */
export function parseS3ObjectUrl(
  url: string,
): { bucket: string; key: string } | null {
  try {
    const u = new URL(url);
    const match = u.hostname.match(
      /^(.+)\.s3(?:\.([a-z0-9-]+))?\.amazonaws\.com$/i,
    );
    if (!match) return null;
    const key = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!key) return null;
    return { bucket: match[1], key };
  } catch {
    return null;
  }
}

export async function presignGetObject(
  bucket: string,
  key: string,
  expiresIn = 60 * 60,
) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn });
}
