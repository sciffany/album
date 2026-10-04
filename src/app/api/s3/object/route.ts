import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBucket, getObjectReadable, presignGetObject } from "@/lib/s3";
import {
  canAccessMediaViaShareToken,
  SHARE_COOKIE_NAME,
} from "@/lib/shares";

function sanitizeDownloadFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "download";
  return base.replace(/["\\\r\n]/g, "_") || "download";
}

/** Same-origin bytes for canvas work. Display still uses the presigned redirect. */
function imageContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request) {
  const session = await auth();
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key || key.includes("\0") || key.startsWith("/") || key.includes("..")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  if (!session?.user) {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SHARE_COOKIE_NAME}=`));
    const token = match
      ? decodeURIComponent(match.slice(SHARE_COOKIE_NAME.length + 1))
      : "";
    if (!token) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    if (!(await canAccessMediaViaShareToken(key, token))) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  if (url.searchParams.get("stream") === "1") {
    try {
      const body = await getObjectReadable(key);
      return new NextResponse(Readable.toWeb(body) as ReadableStream, {
        headers: {
          "Content-Type": imageContentType(key),
          "Cache-Control": "private, no-store",
        },
      });
    } catch (err) {
      console.error("Failed to stream S3 object", key, err);
      return new NextResponse("Bad gateway", { status: 502 });
    }
  }

  const download = url.searchParams.get("download") === "1";
  const requestedName = url.searchParams.get("filename")?.trim();
  const downloadFileName = download
    ? sanitizeDownloadFileName(
        requestedName || key.split("/").pop() || "download",
      )
    : undefined;

  try {
    const signed = await presignGetObject(getBucket(), key, 60 * 60, {
      downloadFileName,
    });
    return NextResponse.redirect(signed);
  } catch (err) {
    console.error("Failed to sign S3 object", key, err);
    return new NextResponse("Bad gateway", { status: 502 });
  }
}
