import { TrashItemRow } from "@/components/TrashItemRow";
import { listTrashMedia } from "@/lib/media-ops";
import { mediaTypeFromKey } from "@/lib/folders";

export default async function TrashPage() {
  const items = await listTrashMedia();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Recycle bin
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Soft-deleted files are kept under a hidden <code>_trash/</code>{" "}
          prefix in your bucket. Restore returns them to their original path;
          delete forever removes the object from storage.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">
          Recycle bin is empty.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <TrashItemRow
              key={item.s3Key}
              s3Key={item.s3Key}
              originalS3Key={item.originalS3Key}
              deletedAt={item.deletedAt}
              caption={item.caption ?? item.aiCaption}
              mediaType={mediaTypeFromKey(item.originalS3Key ?? item.s3Key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
