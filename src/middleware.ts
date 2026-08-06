import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

/** Must match `SHARE_COOKIE_NAME` in `@/lib/shares`. */
const SHARE_COOKIE_NAME = "album_share";

const { auth } = NextAuth(authConfig);

function isSecureRequest(req: { nextUrl: URL; headers: Headers }): boolean {
  if (req.nextUrl.protocol === "https:") return true;
  const proto = req.headers.get("x-forwarded-proto");
  return proto === "https";
}

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isFolderShareRoute = pathname.startsWith("/s/");
  const isTagShareRoute = pathname.startsWith("/t/");
  const isShareRoute = isFolderShareRoute || isTagShareRoute;
  const isS3Route = pathname.startsWith("/api/s3/");
  const shareCookie = req.cookies.get(SHARE_COOKIE_NAME)?.value;

  if (isShareRoute) {
    const token = pathname.split("/")[2];
    const res = NextResponse.next();
    if (token) {
      res.cookies.set(SHARE_COOKIE_NAME, decodeURIComponent(token), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isSecureRequest(req),
      });
    }
    return res;
  }

  if (!isLoggedIn && isS3Route && shareCookie) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isAuthRoute) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isAuthRoute) {
    return NextResponse.redirect(new URL("/browse", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/browse/:path*",
    "/search/:path*",
    "/tags/:path*",
    "/trash",
    "/login",
    "/s/:path*",
    "/t/:path*",
    "/api/tags/:path*",
    "/api/s3/:path*",
    "/api/download/:path*",
  ],
};
