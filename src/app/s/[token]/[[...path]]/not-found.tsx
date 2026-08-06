export default function ShareNotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
        Share not found
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This link may have been revoked or the folder no longer exists.
      </p>
    </div>
  );
}
