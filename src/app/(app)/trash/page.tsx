import { EmptyTrashButton } from "@/components/EmptyTrashButton";
import { TrashItemRow } from "@/components/TrashItemRow";
import { listTrashMedia } from "@/lib/media-ops";
import { mediaTypeFromName } from "@/lib/folders";

export default async function TrashPage() {
  const items = await listTrashMedia();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            Recycle bin
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Soft-deleted files stay in storage until you delete them forever.
            Restore returns them to their folder (or the library root if that
            folder was also deleted).
          </p>
        </div>
        {items.length > 0 && <EmptyTrashButton itemCount={items.length} />}
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">
          Recycle bin is empty.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const displayPath = item.folderPath
              ? `${item.folderPath}/${item.name}`
              : item.name;
            return (
              <TrashItemRow
                key={item.s3Key}
                s3Key={item.s3Key}
                displayPath={displayPath}
                deletedAt={item.deletedAt}
                caption={item.caption ?? item.aiCaption}
                mediaType={mediaTypeFromName(item.name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
