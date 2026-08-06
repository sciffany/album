"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { BulkActionBar } from "@/components/BulkActionBar";
import { BulkMoveDialog } from "@/components/BulkMoveDialog";
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { FolderActions } from "@/components/FolderActions";
import { MediaRow, type MediaItem } from "@/components/MediaRow";
import { SelectionCheckbox } from "@/components/SelectionCheckbox";
import {
  selectionKey,
  type SelectedItem,
} from "@/lib/selection";
import {
  relativePathFromShareRoot,
  sharePath,
} from "@/lib/share-paths";

type FolderItem = {
  name: string;
  path: string;
};

function buildSelectable(
  folders: FolderItem[],
  media: MediaItem[],
): SelectedItem[] {
  return [
    ...folders.map(
      (folder): SelectedItem => ({ kind: "folder", path: folder.path }),
    ),
    ...media.map(
      (item): SelectedItem => ({
        kind: "file",
        s3Key: item.s3Key,
        isMedia: true,
      }),
    ),
  ];
}

function folderBrowseHref(
  folderPath: string,
  share?: { token: string; rootPath: string },
): string {
  if (share) {
    const relative = relativePathFromShareRoot(share.rootPath, folderPath);
    return sharePath(share.token, relative);
  }
  return `/browse/${folderPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function FolderGrid({
  folders,
  media,
  readOnly = false,
  share,
}: {
  folders: FolderItem[];
  media: MediaItem[];
  readOnly?: boolean;
  /** When set (with readOnly), folder links stay under the share URL. */
  share?: { token: string; rootPath: string };
}) {
  const selectable = useMemo(
    () => buildSelectable(folders, media),
    [folders, media],
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [moveItems, setMoveItems] = useState<SelectedItem[]>([]);
  const [tagTargets, setTagTargets] = useState<{
    s3Keys: string[];
    tagLists: { id?: string; text: string }[][];
  }>({ s3Keys: [], tagLists: [] });

  useEffect(() => {
    if (readOnly) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedKeys(new Set());
        setAnchorIndex(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

  const selectedItems = useMemo(
    () => selectable.filter((item) => selectedKeys.has(selectionKey(item))),
    [selectable, selectedKeys],
  );

  const mediaSelected = useMemo(
    () =>
      selectedItems.filter(
        (i): i is Extract<SelectedItem, { kind: "file" }> =>
          i.kind === "file" && i.isMedia,
      ),
    [selectedItems],
  );

  const toggleAt = useCallback(
    (index: number, e: MouseEvent) => {
      const item = selectable[index];
      if (!item) return;
      const key = selectionKey(item);

      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && anchorIndex !== null) {
          const from = Math.min(anchorIndex, index);
          const to = Math.max(anchorIndex, index);
          for (let i = from; i <= to; i += 1) {
            const rangeItem = selectable[i];
            if (rangeItem) next.add(selectionKey(rangeItem));
          }
        } else if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });

      if (!e.shiftKey) setAnchorIndex(index);
    },
    [anchorIndex, selectable],
  );

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(selectable.map(selectionKey)));
    setAnchorIndex(selectable.length > 0 ? 0 : null);
  }, [selectable]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setAnchorIndex(null);
  }, []);

  function openMove() {
    setMoveItems(selectedItems);
    setMoveOpen(true);
  }

  function openTags() {
    const byKey = new Map(
      media.map((m) => [
        m.s3Key,
        m.tags.map((t) => ({ id: t.tag.id, text: t.tag.text })),
      ]),
    );
    setTagTargets({
      s3Keys: mediaSelected.map((m) => m.s3Key),
      tagLists: mediaSelected.map((item) => byKey.get(item.s3Key) ?? []),
    });
    setTagOpen(true);
  }

  if (folders.length === 0 && media.length === 0) {
    return (
      <p className="py-16 text-center text-[var(--muted)]">
        {readOnly
          ? "This folder is empty."
          : "This folder is empty. Create a subfolder or upload files."}
      </p>
    );
  }

  const folderOffset = 0;
  const mediaOffset = folders.length;

  return (
    <div className="space-y-4">
      {!readOnly && (
        <BulkActionBar
          count={selectedItems.length}
          mediaCount={mediaSelected.length}
          onMove={openMove}
          onTags={openTags}
          onSelectAll={selectAll}
          onClear={clearSelection}
        />
      )}

      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {folders.map((folder, i) => {
            const index = folderOffset + i;
            const item: SelectedItem = { kind: "folder", path: folder.path };
            const key = selectionKey(item);
            const isSelected = !readOnly && selectedKeys.has(key);
            return (
              <div
                key={folder.path}
                className={`rounded-lg border p-2 transition ${
                  isSelected
                    ? "border-[var(--accent)] bg-[var(--accent)]/5"
                    : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface)]/60"
                }`}
              >
                <div className="relative">
                  {!readOnly && (
                    <SelectionCheckbox
                      checked={isSelected}
                      label={`Select folder ${folder.name}`}
                      onToggle={(e) => toggleAt(index, e)}
                    />
                  )}
                  <Link
                    href={folderBrowseHref(folder.path, share)}
                    className="flex items-center gap-3"
                  >
                    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-[var(--folder)] sm:h-36 sm:w-36">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-14 w-14 text-[var(--folder-ink)]"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
                        {folder.name}
                      </p>
                      <p className="text-xs text-[var(--muted)]">Folder</p>
                    </div>
                  </Link>
                </div>
                {!readOnly && (
                  <FolderActions path={folder.path} name={folder.name} />
                )}
              </div>
            );
          })}
          {media.map((item, i) => {
            const index = mediaOffset + i;
            const sel: SelectedItem = {
              kind: "file",
              s3Key: item.s3Key,
              isMedia: true,
            };
            return (
              <MediaRow
                key={item.id}
                media={item}
                readOnly={readOnly}
                selected={!readOnly && selectedKeys.has(selectionKey(sel))}
                onToggleSelect={
                  readOnly ? undefined : (e) => toggleAt(index, e)
                }
              />
            );
          })}
        </div>
      </div>

      {!readOnly && (
        <>
          <BulkMoveDialog
            items={moveItems}
            open={moveOpen}
            onClose={() => setMoveOpen(false)}
            onDone={clearSelection}
          />
          <BulkTagDialog
            s3Keys={tagTargets.s3Keys}
            tagLists={tagTargets.tagLists}
            open={tagOpen}
            onClose={() => {
              setTagOpen(false);
              clearSelection();
            }}
            onDone={() => {
              /* selection cleared when dialog closes */
            }}
          />
        </>
      )}
    </div>
  );
}
