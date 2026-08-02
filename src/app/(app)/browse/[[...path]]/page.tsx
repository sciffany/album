import { notFound } from "next/navigation";
import { FolderBreadcrumb } from "@/components/FolderBreadcrumb";
import { FolderGrid } from "@/components/FolderGrid";
import {
  assertPrefixExists,
  breadcrumbFromPath,
  listFolderContents,
  pathFromSegments,
} from "@/lib/folders";

export default async function BrowsePage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path: segments } = await params;
  const path = pathFromSegments(segments);

  if (path && !(await assertPrefixExists(path))) {
    notFound();
  }

  const { folders, media } = await listFolderContents(path);
  const crumbs = breadcrumbFromPath(path);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <FolderBreadcrumb crumbs={crumbs} />
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          {path ? path.split("/").at(-1) : "Library"}
        </h1>
      </div>
      <FolderGrid folders={folders} media={media} />
    </div>
  );
}
