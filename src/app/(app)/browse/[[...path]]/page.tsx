import { notFound, redirect } from "next/navigation";
import { BrowseToolbar } from "@/components/BrowseToolbar";
import { FolderBreadcrumb } from "@/components/FolderBreadcrumb";
import { FolderGrid } from "@/components/FolderGrid";
import {
  assertFolderExists,
  breadcrumbFromPath,
  listFolderContents,
  pathFromSegments,
} from "@/lib/folders";
import { activeShareFolderPaths } from "@/lib/shares";
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

  if (path && !(await assertFolderExists(path))) {
    notFound();
  }

  const { folders, media } = await listFolderContents(path);
  const sharedPaths = await activeShareFolderPaths([
    ...(path ? [path] : []),
    ...folders.map((folder) => folder.path),
  ]);
  const crumbs = breadcrumbFromPath(path);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <FolderBreadcrumb crumbs={crumbs} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {path ? path.split("/").at(-1) : "Library"}
          </h1>
          <BrowseToolbar
            path={path}
            hasShare={Boolean(path && sharedPaths.has(path))}
          />
        </div>
      </div>
      <FolderGrid
        folders={folders.map((folder) => ({
          ...folder,
          hasShare: sharedPaths.has(folder.path),
        }))}
        media={media}
      />
    </div>
  );
}
