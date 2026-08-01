import Link from "next/link";

export default function BrowseNotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
        Folder not found
      </h1>
      <p className="mt-2 text-[var(--muted)]">
        That path does not exist in the library.
      </p>
      <Link
        href="/browse"
        className="mt-6 inline-block text-[var(--accent)] hover:underline"
      >
        Back to library
      </Link>
    </div>
  );
}
