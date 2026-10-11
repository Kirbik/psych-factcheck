const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1_000, 2_000, 4_000, 8_000] as const;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type Wait = (milliseconds: number) => Promise<void>;
type FailureKind = "network_error" | "transient_http_status";
type SupabaseRoute = "rest_rpc" | "rest_table" | "storage" | "auth" | "other";

export type FetchRetryFailure = {
  readonly method: string;
  readonly host: string;
  readonly route: SupabaseRoute;
  readonly attempts: number;
  readonly kind: FailureKind;
  readonly errorName?: "TypeError" | "AbortError" | "TimeoutError";
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

/** Retries transient failures for idempotent Worker-to-Supabase requests. */
export function createRetryingFetch(
  fetchImplementation: typeof fetch = fetch,
  waitBeforeRetry: Wait = wait,
  logFailure: FailureLogger = (failure) =>
    console.warn("[worker] Supabase fetch retry budget exhausted", failure),
): typeof fetch {
  return async (input, init) => {
    const metadata = requestMetadata(input, init);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        const requestInput = input instanceof Request ? input.clone() : input;
        response = await fetchImplementation(requestInput, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (!isRetryableNetworkError(error)) {
          throw error;
        }
        if (attempt >= MAX_RETRIES) {
          logFailure({
            ...metadata,
            attempts: attempt + 1,
            kind: "network_error",
            ...(networkErrorName(error)
              ? { errorName: networkErrorName(error) }
              : {}),
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
