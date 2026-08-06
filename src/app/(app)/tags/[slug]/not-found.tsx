export default function TagNotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
        Tag not found
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This tag does not exist in your library.
      </p>
    </div>
  );
}