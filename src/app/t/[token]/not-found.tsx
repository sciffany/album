import Link from "next/link";

export default function TagShareNotFound() {
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
        Share not found
      </h1>
      <p className="text-sm text-[var(--muted)]">
        This link may have been revoked or is invalid.
      </p>
      <Link
        href="/login"
        className="inline-block text-sm text-[var(--ink)] underline underline-offset-2"
      >
        Sign in
      </Link>
    </div>
  );
}
