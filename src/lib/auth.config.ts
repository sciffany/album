import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const allowed = allowedEmails();
      if (allowed.size === 0) return false;
      return allowed.has(email);
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/api/auth")) return true;
      if (pathname.startsWith("/login")) return true;
      return !!auth;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
