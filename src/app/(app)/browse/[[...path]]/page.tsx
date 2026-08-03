import { notFound, redirect } from "next/navigation";
import { BrowseToolbar } from "@/components/BrowseToolbar";
import { FolderBreadcrumb } from "@/components/FolderBreadcrumb";
import { FolderGrid } from "@/components/FolderGrid";
import {
  assertPrefixExists,
  breadcrumbFromPath,
  listFolderContents,
  pathFromSegments,
} from "@/lib/folders";
import { isTrashFolderPath } from "@/lib/storage-keys";

export default async function BrowsePage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path: segments } = await params;
  const path = pathFromSegments(segments);

  if (isTrashFolderPath(path)) {
    redirect("/trash");
  }

  // List once — existence check only when empty (avoids a second full S3 list).
  const { folders, media, otherFiles } = await listFolderContents(path);
  if (
    path &&
    folders.length === 0 &&
    media.length === 0 &&
    otherFiles.length === 0 &&
    !(await assertPrefixExists(path))
  ) {
    notFound();
  }

  const crumbs = breadcrumbFromPath(path);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <FolderBreadcrumb crumbs={crumbs} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {path ? path.split("/").at(-1) : "Library"}
          </h1>
          <BrowseToolbar path={path} />
        </div>
      </div>
      <FolderGrid folders={folders} media={media} otherFiles={otherFiles} />
    </div>
  );
}
