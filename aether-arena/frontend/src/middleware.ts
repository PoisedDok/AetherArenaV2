import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) =>
      pathname === p ||
      pathname.startsWith(p + "/") ||
      pathname.startsWith(p + "?"),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Electron desktop shell injects this header via session.webRequest in main.js.
  // The app only serves localhost so this header is never reachable from the web.
  if (request.headers.get("x-electron-app") === "aether-arena") {
    return NextResponse.next();
  }

  // Check session by calling the better-auth session endpoint
  const sessionUrl = new URL("/api/auth/get-session", request.nextUrl.origin);
  const sessionRes = await fetch(sessionUrl.toString(), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });

  const session = sessionRes.ok ? await sessionRes.json() : null;

  if (!session?.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|css|js|map)).*)",
  ],
};
