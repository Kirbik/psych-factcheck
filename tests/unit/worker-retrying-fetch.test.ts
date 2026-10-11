import { describe, expect, it, vi } from "vitest";
import { createRetryingFetch } from "../../worker/retrying-fetch";

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
