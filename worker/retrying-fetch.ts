const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1_000, 2_000, 4_000, 8_000] as const;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type Wait = (milliseconds: number) => Promise<void>;
type FailureKind =
  | "network_error"
  | "response_body_error"
  | "transient_http_status"
  | "unexpected_error";
type SupabaseRoute = "rest_rpc" | "rest_table" | "storage" | "auth" | "other";

export type FetchRetryFailure = {
  readonly method: string;
  readonly host: string;
  readonly route: SupabaseRoute;
  readonly attempts: number;
  readonly kind: FailureKind;
  readonly phase?: "fetch" | "response_body";
  readonly errorName?:
    | "TypeError"
    | "AbortError"
    | "TimeoutError"
    | "Error"
    | "UnknownError";
  readonly status?: number;
};

type FailureLogger = (failure: FetchRetryFailure) => void;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function requestMetadata(input: RequestInfo | URL, init?: RequestInit) {
  let url: URL | null = null;
  try {
    url = new URL(input instanceof Request ? input.url : input.toString());
  } catch {
    // Keep diagnostics useful without ever logging the raw request URL.
  }

  const path = url?.pathname.split("/").filter(Boolean) ?? [];
  const route: SupabaseRoute =
    path[0] === "rest" && path[1] === "v1"
      ? path[2] === "rpc"
        ? "rest_rpc"
        : "rest_table"
      : path[0] === "storage"
        ? "storage"
        : path[0] === "auth"
          ? "auth"
          : "other";

  return {
    method: (init?.method ?? (input instanceof Request ? input.method : "GET"))
      .toUpperCase()
      .slice(0, 12),
    host: url?.hostname.slice(0, 253) ?? "unavailable",
    route,
  } as const;
}

function networkErrorName(error: unknown): FetchRetryFailure["errorName"] {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof DOMException) {
    if (error.name === "AbortError" || error.name === "TimeoutError")
      return error.name;
  }
  return undefined;
}

function sanitizedErrorName(error: unknown): FetchRetryFailure["errorName"] {
  const knownNetworkName = networkErrorName(error);
  if (knownNetworkName) return knownNetworkName;
  return error instanceof Error ? "Error" : "UnknownError";
}

function isRetryableNetworkError(error: unknown) {
  if (error instanceof TypeError) return true;
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function retryAfterMilliseconds(response: Response, fallback: number) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallback;

  const seconds = Number(retryAfter);
  const requestedDelay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(retryAfter) - Date.now();
  if (!Number.isFinite(requestedDelay)) return fallback;
  return Math.min(2_000, Math.max(0, requestedDelay));
}

async function bufferRestResponse(response: Response): Promise<Response> {
  if (response.body === null) return response;

  const body = await response.arrayBuffer();
  return new Response(body.byteLength > 0 ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Retries transient failures for idempotent Worker-to-Supabase requests. */
export function createRetryingFetch(
  fetchImplementation: typeof fetch = fetch,
  waitBeforeRetry: Wait = wait,
  logFailure: FailureLogger = (failure) =>
    console.warn("[worker] Supabase fetch failed", failure),
): typeof fetch {
  return async (input, init) => {
    const metadata = requestMetadata(input, init);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      let failurePhase: "fetch" | "response_body" = "fetch";
      try {
        const requestInput = input instanceof Request ? input.clone() : input;
        response = await fetchImplementation(requestInput, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (metadata.route === "rest_rpc" || metadata.route === "rest_table") {
          failurePhase = "response_body";
          response = await bufferRestResponse(response);
        }
      } catch (error) {
        const retryable =
          failurePhase === "response_body" || isRetryableNetworkError(error);
        if (!retryable) {
          logFailure({
            ...metadata,
            attempts: attempt + 1,
            kind: "unexpected_error",
            phase: failurePhase,
            errorName: sanitizedErrorName(error),
          });
          throw error;
        }
        if (attempt >= MAX_RETRIES) {
          logFailure({
            ...metadata,
            attempts: attempt + 1,
            kind:
              failurePhase === "response_body" &&
              !isRetryableNetworkError(error)
                ? "response_body_error"
                : "network_error",
            phase: failurePhase,
            errorName: sanitizedErrorName(error),
          });
          throw error;
        }
        await waitBeforeRetry(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      if (!RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      if (attempt >= MAX_RETRIES) {
        logFailure({
          ...metadata,
          attempts: attempt + 1,
          kind: "transient_http_status",
          status: response.status,
        });
        return response;
      }

      await response.body?.cancel().catch(() => undefined);
      await waitBeforeRetry(
        retryAfterMilliseconds(response, RETRY_DELAYS_MS[attempt]),
      );
    }
  };
}
