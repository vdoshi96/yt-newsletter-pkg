import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, cookieName } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    const token = request.cookies.get(cookieName())?.value;
    const ok = token ? await verifySessionToken(token) : false;
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (pathname === "/") {
    const token = request.cookies.get(cookieName())?.value;
    const ok = token ? await verifySessionToken(token) : false;
    const dest = ok ? "/dashboard" : "/login";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get(cookieName())?.value;
    const ok = token ? await verifySessionToken(token) : false;
    if (!ok) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/api/:path*"],
};
