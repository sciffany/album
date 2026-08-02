import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseS3ObjectUrl, presignGetObject } from "@/lib/s3";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const media = await prisma.media.findUnique({
    where: { id },
    select: { thumbnailPath: true },
  });

  if (!media?.thumbnailPath) {
    return new NextResponse("Not found", { status: 404 });
  }

  const parsed = parseS3ObjectUrl(media.thumbnailPath);
  if (!parsed) {
    // Non-S3 thumbs (e.g. seed picsum URLs) — redirect as-is.
    return NextResponse.redirect(media.thumbnailPath);
  }

  const allowedBucket = process.env.S3_BUCKET;
  if (allowedBucket && parsed.bucket !== allowedBucket) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const signed = await presignGetObject(parsed.bucket, parsed.key);
    return NextResponse.redirect(signed);
  } catch (err) {
    console.error("Failed to sign thumbnail", id, err);
    return new NextResponse("Bad gateway", { status: 502 });
  }
}
