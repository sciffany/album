"use client";

import {
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  completeUploadsAction,
  createFolderAction,
  presignUploadsAction,
} from "@/lib/actions";

const MEDIA_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.bmp,.mp4,.mov,.m4v,.webm,.mkv,.avi,image/*,video/*";

const MEDIA_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
  "bmp",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
]);

function isAllowedMediaFile(file: File): boolean {
  const base = file.name.split("/").pop() ?? file.name;
  if (base.startsWith(".")) return false;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXT.has(ext);
}

type Props = {
  path: string;
};

export function BrowseToolbar({ path }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [pending, startTransition] = useTransition();
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openNewFolder() {
    setFolderName("");
    setError(null);
    setNewFolderOpen(true);
  }

  function submitNewFolder(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createFolderAction(path, folderName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewFolderOpen(false);
      router.refresh();
    });
  }

  async function uploadFileList(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);

    const files = Array.from(fileList).filter(
      (f) => f.size > 0 && isAllowedMediaFile(f),
    );
    if (!files.length) {
      setError("No supported media files in the selection");
      return;
    }

    const batchSize = 40;
    const uploadedItems: {
      key: string;
      folderPath: string;
      name: string;
    }[] = [];

    try {
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        setUploadProgress(
          `Preparing ${Math.min(i + batch.length, files.length)} / ${files.length}…`,
        );

        const prepared = await presignUploadsAction(
          path,
          batch.map((file) => ({
            relativePath: file.webkitRelativePath || file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          })),
        );

        if (!prepared.ok) {
          setError(prepared.error);
          setUploadProgress(null);
          return;
        }

        for (let j = 0; j < prepared.uploads.length; j++) {
          const upload = prepared.uploads[j]!;
          const file = batch[j]!;
          setUploadProgress(
            `Uploading ${uploadedItems.length + 1} / ${files.length}…`,
          );

          const res = await fetch(upload.url, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": upload.contentType,
            },
          });

          if (!res.ok) {
            throw new Error(
              `Upload failed for ${file.webkitRelativePath || file.name} (${res.status})`,
            );
          }
          uploadedItems.push({
            key: upload.key,
            folderPath: upload.folderPath,
            name: upload.name,
          });
        }
      }

      setUploadProgress("Finishing…");
      const done = await completeUploadsAction(uploadedItems);
      if (!done.ok) {
        setError(done.error);
        setUploadProgress(null);
        return;
      }

      setUploadProgress(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadProgress(null);
      if (uploadedItems.length > 0) {
        await completeUploadsAction(uploadedItems).catch(() => undefined);
        router.refresh();
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    startTransition(() => {
      void uploadFileList(list);
    });
  }

  const busy = pending || !!uploadProgress;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openNewFolder}
          disabled={busy}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          New folder
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          Upload files
        </button>
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={busy}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          Upload folder
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <input
          ref={(el) => {
            folderInputRef.current = el;
            if (el) {
              el.setAttribute("webkitdirectory", "");
              el.setAttribute("directory", "");
            }
          }}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        {uploadProgress && (
          <span className="text-xs text-[var(--muted)]">{uploadProgress}</span>
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {newFolderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-folder-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setNewFolderOpen(false);
          }}
        >
          <form
            onSubmit={submitNewFolder}
            className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
          >
            <h2
              id="new-folder-title"
              className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
            >
              New folder
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {path ? (
                <>
                  Inside <span className="text-[var(--ink)]">{path}</span>
                </>
              ) : (
                "At library root"
              )}
            </p>
            <label className="mt-4 block text-xs font-medium text-[var(--muted)]">
              Folder name
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Japan Trip"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              />
            </label>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                disabled={pending}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !folderName.trim()}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
