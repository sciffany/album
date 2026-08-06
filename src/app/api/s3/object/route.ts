import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBucket, presignGetObject } from "@/lib/s3";
import {
  getActiveShareByToken,
  isMediaUnderShare,
  SHARE_COOKIE_NAME,
} from "@/lib/shares";

function sanitizeDownloadFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "download";
  return base.replace(/["\\\r\n]/g, "_") || "download";
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
    const share = await getActiveShareByToken(token);
    if (!share || !(await isMediaUnderShare(key, share))) {
      return new NextResponse("Forbidden", { status: 403 });
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
