import { Readable, PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listFolderDownloadEntries } from "@/lib/folders";
import { getObjectReadable } from "@/lib/s3";
import {
  assertValidFolderPath,
  isTrashFolderPath,
} from "@/lib/storage-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sanitizeZipFileName(name: string): string {
  const base = name.replace(/["\\\r\n/]/g, "_").trim() || "folder";
  return base.endsWith(".zip") ? base : `${base}.zip`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path")?.trim() ?? "";

  let folderPath: string;
  try {
    folderPath = assertValidFolderPath(rawPath, "folder path");
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  if (!folderPath || isTrashFolderPath(folderPath)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  let folderName: string;
  let entries: Awaited<ReturnType<typeof listFolderDownloadEntries>>["entries"];
  try {
    ({ folderName, entries } = await listFolderDownloadEntries(folderPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Folder not found";
    if (message === "Folder not found") {
      return new NextResponse("Not found", { status: 404 });
    }
    console.error("Failed to list folder for download", folderPath, err);
    return new NextResponse("Bad gateway", { status: 502 });
  }

  if (entries.length === 0) {
    return new NextResponse("Folder is empty", { status: 404 });
  }

  const passthrough = new PassThrough();
  const archive = new ZipArchive({ store: true });

  archive.on("error", (err: Error) => {
    console.error("Zip archive error", folderPath, err);
    passthrough.destroy(err);
  });

  archive.pipe(passthrough);

  void (async () => {
    try {
      for (const entry of entries) {
        const body = await getObjectReadable(entry.s3Key);
        archive.append(body, { name: entry.zipPath, store: true });
        // Wait until this object is fully consumed before opening the next.
        await finished(body);
      }
      await archive.finalize();
    } catch (err) {
      console.error("Failed while building folder zip", folderPath, err);
      archive.abort();
      passthrough.destroy(
        err instanceof Error ? err : new Error("Failed to build zip"),
      );
    }
  })();

  const zipName = sanitizeZipFileName(folderName);
  return new Response(Readable.toWeb(passthrough) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}
