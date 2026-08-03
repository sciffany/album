export default function BrowseLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        <div className="h-4 w-40 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-9 w-56 animate-pulse rounded bg-[var(--surface-2)]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 p-2">
            <div className="h-28 w-28 shrink-0 animate-pulse rounded-md bg-[var(--surface-2)] sm:h-36 sm:w-36" />
            <div className="flex flex-1 flex-col justify-center gap-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--surface-2)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
