import { signIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const denied = params.error === "AccessDenied";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_#d9e8e1_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_right,_#efe6d4_0%,_transparent_50%)]" />
      <div className="w-full max-w-md text-center">
        <h1 className="font-[family-name:var(--font-display)] text-5xl tracking-tight text-[var(--ink)] sm:text-6xl">
          Album
        </h1>
        <p className="mt-3 text-[var(--muted)]">
          Sign in to browse folders, tag photos, and search your library.
        </p>
        {denied && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            That Google account is not on the allowlist.
          </p>
        )}
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: params.callbackUrl || "/browse",
            });
          }}
        >
          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[var(--accent)] px-6 text-base font-medium text-white transition hover:bg-[var(--accent-hover)]"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
