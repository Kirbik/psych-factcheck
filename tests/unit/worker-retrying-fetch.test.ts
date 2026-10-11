import { describe, expect, it, vi } from "vitest";
import {
  createRetryingFetch,
  type FetchRetryFailure,
} from "../../worker/retrying-fetch";

describe("Worker Supabase fetch retries", () => {
  it("retries transient network errors and then returns the response", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response("ok"));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const fetchWithRetry = createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    );

    const response = await fetchWithRetry("https://example.org", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledWith(250);
  });

  it("keeps retrying a temporary network outage with bounded backoff", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response("ok"));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    )("https://example.org");

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(1, 250);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(2, 1_000);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(3, 2_000);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(4, 4_000);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(5, 8_000);
  });

  it("logs sanitized endpoint metadata when network retries are exhausted", async () => {
    const timeout = new DOMException("request timed out", "TimeoutError");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(timeout);
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const logFailure = vi.fn<(failure: FetchRetryFailure) => void>();

    await expect(
      createRetryingFetch(
        fetchImplementation,
        waitBeforeRetry,
        logFailure,
      )(
        "https://project.supabase.co/rest/v1/rpc/advance_analysis_job?token=secret",
        { method: "post", body: "private payload" },
      ),
    ).rejects.toBe(timeout);

    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(logFailure).toHaveBeenCalledTimes(1);
    expect(logFailure).toHaveBeenCalledWith({
      method: "POST",
      host: "project.supabase.co",
      route: "rest_rpc",
      attempts: 6,
      kind: "network_error",
      phase: "fetch",
      errorName: "TimeoutError",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain(
      "private payload",
    );
  });

  it("logs the final transient HTTP status after exhausting retries", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 503 }));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const logFailure = vi.fn<(failure: FetchRetryFailure) => void>();

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
      logFailure,
    )("https://project.supabase.co/rest/v1/fact_checks", {
      method: "GET",
    });

    expect(response.status).toBe(503);
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(logFailure).toHaveBeenCalledExactlyOnceWith({
      method: "GET",
      host: "project.supabase.co",
      route: "rest_table",
      attempts: 6,
      kind: "transient_http_status",
      status: 503,
    });
  });

  it("retries a REST response whose body stream fails after HTTP headers arrive", async () => {
    const bodyFailure = new TypeError("response body connection reset");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              controller.error(bodyFailure);
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"claim_id":"claim-1"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    )("https://project.supabase.co/rest/v1/evidence_packages?select=payload");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claim_id: "claim-1" });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledWith(250);
  });

  it("logs sanitized response-body failures when retries are exhausted", async () => {
    const bodyFailure = new TypeError("response body connection reset");
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(bodyFailure);
            },
          }),
          { status: 200 },
        ),
    );
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const logFailure = vi.fn<(failure: FetchRetryFailure) => void>();

    await expect(
      createRetryingFetch(
        fetchImplementation,
        waitBeforeRetry,
        logFailure,
      )("https://project.supabase.co/rest/v1/evidence_packages?select=private"),
    ).rejects.toBe(bodyFailure);

    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(logFailure).toHaveBeenCalledExactlyOnceWith({
      method: "GET",
      host: "project.supabase.co",
      route: "rest_table",
      attempts: 6,
      kind: "network_error",
      phase: "response_body",
      errorName: "TypeError",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("private");
  });

  it("retries response-body failures that are not TypeErrors", async () => {
    const bodyFailure = new Error("stream interrupted");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(bodyFailure);
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    )("https://project.supabase.co/rest/v1/rpc/save_fact_check");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledWith(250);
  });

  it("retries unexpected PostgREST fetch errors before logging sanitized details", async () => {
    const fetchError = new Error("sensitive details must not be logged");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(fetchError)
      .mockRejectedValueOnce(fetchError)
      .mockRejectedValueOnce(fetchError)
      .mockRejectedValueOnce(fetchError)
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce(new Response("ok"));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const logFailure = vi.fn<(failure: FetchRetryFailure) => void>();

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
      logFailure,
    )("https://project.supabase.co/rest/v1/rpc/save_fact_check?secret=value", {
      method: "POST",
      body: "private payload",
    });

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(1, 250);
    expect(waitBeforeRetry).toHaveBeenNthCalledWith(5, 8_000);
    expect(logFailure).not.toHaveBeenCalled();
  });

  it("logs an exhausted unexpected PostgREST fetch error without its message", async () => {
    const fetchError = new Error("sensitive details must not be logged");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(fetchError);
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );
    const logFailure = vi.fn<(failure: FetchRetryFailure) => void>();

    await expect(
      createRetryingFetch(
        fetchImplementation,
        waitBeforeRetry,
        logFailure,
      )(
        "https://project.supabase.co/rest/v1/rpc/save_fact_check?secret=value",
        { method: "POST", body: "private payload" },
      ),
    ).rejects.toBe(fetchError);

    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(logFailure).toHaveBeenCalledExactlyOnceWith({
      method: "POST",
      host: "project.supabase.co",
      route: "rest_rpc",
      attempts: 6,
      kind: "unexpected_error",
      phase: "fetch",
      errorName: "Error",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain(
      "sensitive details",
    );
  });

  it("does not retry unexpected errors for unclassified endpoints", async () => {
    const fetchError = new Error("unexpected endpoint error");
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(fetchError);
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    await expect(
      createRetryingFetch(
        fetchImplementation,
        waitBeforeRetry,
      )("https://example.org/api"),
    ).rejects.toBe(fetchError);

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(waitBeforeRetry).not.toHaveBeenCalled();
  });

  it("honors Retry-After for transient provider responses", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    )("https://example.org");

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledWith(0);
  });

  it("does not retry non-transient responses", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const waitBeforeRetry = vi.fn<(...args: [number]) => Promise<void>>(
      async () => undefined,
    );

    const response = await createRetryingFetch(
      fetchImplementation,
      waitBeforeRetry,
    )("https://example.org");

    expect(response.status).toBe(400);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(waitBeforeRetry).not.toHaveBeenCalled();
  });
});
