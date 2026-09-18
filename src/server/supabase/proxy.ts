import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import type { Database } from "@/types/database";

function copySessionResponse(
  source: NextResponse,
  destination: NextResponse,
) {
  source.cookies.getAll().forEach((cookie) => {
    destination.cookies.set(cookie);
  });

  for (const [name, value] of source.headers.entries()) {
    if (name.toLowerCase() !== "set-cookie") {
      destination.headers.set(name, value);
    }
  }

  return destination;
}

/** Refreshes cookies and performs only an optimistic protected-route redirect. */
export async function updateAuthSession(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  // Keep this immediately after client construction: a refresh must happen
  // before a response is generated so its updated cookies can be returned.
  const { data, error } = await supabase.auth.getClaims();
  if (!error && data?.claims?.sub) {
    return response;
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", "/dashboard");
  return copySessionResponse(response, NextResponse.redirect(loginUrl));
}
