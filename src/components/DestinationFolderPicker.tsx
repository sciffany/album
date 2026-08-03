"use client";

import { useEffect, useState } from "react";
import { listFoldersAction } from "@/lib/actions";
import { parentFolder } from "@/lib/storage-keys";

export function DestinationFolderPicker({
  folder,
  onFolderChange,
}: {
  folder: string;
  onFolderChange: (folder: string) => void;
}) {
  const [children, setChildren] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listFoldersAction(folder)
      .then((paths) => {
        if (!cancelled) setChildren(paths);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  return (
    <div>
      <label className="block text-xs font-medium text-[var(--muted)]">
        Destination folder
        <input
          value={folder}
          onChange={(e) => onFolderChange(e.target.value)}
          placeholder="e.g. Family/2024 (empty = root)"
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />
      </label>

      {(children.length > 0 || folder) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onFolderChange(parentFolder(folder))}
            disabled={!folder}
            className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] disabled:opacity-40"
          >
            Up
          </button>
          {children.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => onFolderChange(path)}
              className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]"
            >
              {path.split("/").pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
