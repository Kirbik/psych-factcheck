import handler from "vinext/server/fetch-handler";

type WorkerExecutionContext = {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerEnvironment = Record<string, unknown>;

const supabaseEnvironmentKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Keep server-only modules compatible with Cloudflare bindings. Vinext reads
 * runtime configuration through process.env, while Workers expose bindings
 * through the fetch handler's environment argument.
 */
function populateSupabaseProcessEnv(environment: WorkerEnvironment) {
  for (const key of supabaseEnvironmentKeys) {
    const value = environment[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
}

function withUtf8ContentType(response: Response) {
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("text/x-component") || contentType.includes("charset=")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", `${contentType}; charset=utf-8`);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const worker = {
  async fetch(
    request: Request,
    environment: WorkerEnvironment,
    context: WorkerExecutionContext,
  ) {
    populateSupabaseProcessEnv(environment);
    const response = await handler.fetch(request, environment, context);
    return withUtf8ContentType(response);
  },
};

export default worker;
