import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/lib/auth";
import { SearchBar } from "@/components/SearchBar";

export async function AppHeader() {
  const session = await auth();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/browse"
            className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]"
          >
            Album
          </Link>
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            {session?.user?.email && (
              <span className="hidden sm:inline">{session.user.email}</span>
            )}
            {session && (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 transition hover:bg-[var(--surface-2)]"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
        {session && (
          <Suspense fallback={<div className="h-10" />}>
            <SearchBar />
          </Suspense>
        )}
      </div>
    </header>
  );
}
