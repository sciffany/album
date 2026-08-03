import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBucket, presignGetObject } from "@/lib/s3";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key || key.includes("\0") || key.startsWith("/") || key.includes("..")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const download = url.searchParams.get("download") === "1";
  const downloadFileName = download
    ? (key.split("/").pop() || "download")
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
