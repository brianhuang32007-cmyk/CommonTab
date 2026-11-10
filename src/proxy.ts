import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every page: keeps the login session fresh and guards pages.
const SIGNED_IN_ONLY = ["/onboarding", "/dashboard", "/group", "/contacts", "/ai", "/documents", "/notifications", "/preferences", "/profile"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // Signed out: the app pages send you back to the landing page.
  if (!signedIn && SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) {
    return redirectTo("/");
  }
  // Signed in: the landing and log in pages send you into the app.
  if (signedIn && (path === "/" || path === "/login")) {
    return redirectTo("/dashboard");
  }

  return response;
}

export const config = {
  // Skip static files and images.
  matcher: ["/((?!_next/static|_next/image|icon.svg|brand/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
