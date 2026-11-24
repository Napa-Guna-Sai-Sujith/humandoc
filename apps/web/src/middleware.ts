import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";

  if (!request.cookies.get("hd_csrf")?.value) {
    response.cookies.set("hd_csrf", crypto.randomUUID().replace(/-/g, ""), {
      path: "/",
      sameSite: isHttps ? "none" : "lax",
      secure: isHttps,
      ...(isHttps ? { partitioned: true } : {}),
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|backend|s3|api).*)"],
};
