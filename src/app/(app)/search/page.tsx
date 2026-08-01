import { FolderGrid } from "@/components/FolderGrid";
import { searchMedia } from "@/lib/search";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}) {
  const { q = "", from = "", to = "" } = await searchParams;
  const hasQuery = Boolean(q.trim() || from || to);
  const results = hasQuery ? await searchMedia({ q, from, to }) : [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Search
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Match tags and captions, optionally filtered by date taken.
        </p>
      </div>

      {!hasQuery ? (
        <p className="py-12 text-center text-[var(--muted)]">
          Enter a query or date range to search.
        </p>
      ) : results.length === 0 ? (
        <p className="py-12 text-center text-[var(--muted)]">No matches.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          <FolderGrid folders={[]} media={results} />
        </div>
      )}
    </div>
  );
}
