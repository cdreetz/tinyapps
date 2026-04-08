import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  // Strip Accept-Encoding for SSE API routes to prevent compression buffering
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    headers.delete("accept-encoding");
    return NextResponse.next({
      request: { headers },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
