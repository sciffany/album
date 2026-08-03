export type SelectedItem =
  | { kind: "folder"; path: string }
  | { kind: "file"; s3Key: string; isMedia: boolean };

export function selectionKey(item: SelectedItem): string {
  return item.kind === "folder" ? `folder:${item.path}` : `file:${item.s3Key}`;
}
