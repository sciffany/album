import { notFound } from "next/navigation";
import { FolderBreadcrumb } from "@/components/FolderBreadcrumb";
import { FolderGrid } from "@/components/FolderGrid";
import {
  assertFolderExists,
  listFolderContents,
  pathFromSegments,
} from "@/lib/folders";
import {
  getActiveShareByToken,
  relativePathFromShareRoot,
  resolveShareBrowsePath,
  sharePath,
} from "@/lib/shares";
import { isTrashFolderPath } from "@/lib/storage-keys";

export default async function ShareBrowsePage({
  params,
}: {
  params: Promise<{ token: string; path?: string[] }>;
}) {
  const { token: rawToken, path: segments } = await params;
  const token = decodeURIComponent(rawToken);
  const share = await getActiveShareByToken(token);
  if (!share) {
    notFound();
  }

  const relative = pathFromSegments(segments);
  const absolutePath = resolveShareBrowsePath(share.folderPath, relative);
  if (
    !absolutePath ||
    isTrashFolderPath(absolutePath) ||
    isTrashFolderPath(relative)
  ) {
    notFound();
  }
  if (!(await assertFolderExists(absolutePath))) {
    notFound();
  }

  const { folders, media } = await listFolderContents(absolutePath);

  const relativeForCrumbs = relativePathFromShareRoot(
    share.folderPath,
    absolutePath,
  );
  const crumbParts = relativeForCrumbs
    ? relativeForCrumbs.split("/")
    : ([] as string[]);
  const crumbs = crumbParts.map((name, i) => {
    const rel = crumbParts.slice(0, i + 1).join("/");
    return {
      name,
      href: sharePath(share.token, rel),
    };
  });

  const title =
    absolutePath === share.folderPath
      ? share.folderName
      : (absolutePath.split("/").at(-1) ?? share.folderName);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <FolderBreadcrumb
          crumbs={crumbs}
          rootHref={sharePath(share.token)}
          rootLabel={share.folderName}
        />
        <div className="flex flex-col gap-1">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {title}
          </h1>
          <p className="text-sm text-[var(--muted)]">Shared album · view only</p>
        </div>
      </div>
      <FolderGrid
        folders={folders}
        media={media}
        readOnly
        share={{ token: share.token, rootPath: share.folderPath }}
      />
    </div>
  );
}
