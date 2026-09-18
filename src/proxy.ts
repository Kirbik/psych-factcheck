import type { NextRequest } from "next/server";
import { updateAuthSession } from "@/server/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateAuthSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
