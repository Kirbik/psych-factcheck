const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1_000, 2_000, 4_000, 8_000] as const;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type Wait = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        const requestInput = input instanceof Request ? input.clone() : input;
        response = await fetchImplementation(requestInput, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt >= MAX_RETRIES || !isRetryableNetworkError(error)) {
          throw error;
        }
        await waitBeforeRetry(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      if (attempt >= MAX_RETRIES || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }

      await response.body?.cancel().catch(() => undefined);
      await waitBeforeRetry(
        retryAfterMilliseconds(response, RETRY_DELAYS_MS[attempt]),
      );
    }
  };
}
