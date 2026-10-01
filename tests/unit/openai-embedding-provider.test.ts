import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
} from "@/server/ai/embeddings";
import {
  createOpenAIEmbeddingProvider,
  EmbeddingProviderError,
} from "@/server/ai/openai-embedding-provider";

const vector = Array.from(
  { length: EMBEDDING_DIMENSIONS },
  (_, index) => index / 10_000,
);

function apiResponse(data: unknown[], model = EMBEDDING_MODEL) {
  return new Response(JSON.stringify({ data, model }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAI embedding provider", () => {
  it("requests versioned vectors and restores input order from response indexes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse([
        { index: 1, embedding: vector.map((value) => value + 1) },
        { index: 0, embedding: vector },
      ]),
    );
    const provider = createOpenAIEmbeddingProvider("secret", fetcher);

    await expect(
      provider.embed(["first claim", "second claim"]),
    ).resolves.toEqual([vector, vector.map((value) => value + 1)]);
    expect(provider).toMatchObject({
      provider: "openai",
      model: EMBEDDING_MODEL,
      version: EMBEDDING_VERSION,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request).toEqual({
      model: EMBEDDING_MODEL,
      input: ["first claim", "second claim"],
      encoding_format: "float",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/embeddings",
    );
  });

  it("splits large batches without changing result order", async () => {
    const texts = Array.from({ length: 65 }, (_, index) => `claim ${index}`);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return apiResponse(
          body.input.map((_, index) => ({ index, embedding: vector })),
        );
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return apiResponse(
          body.input.map((_, index) => ({ index, embedding: vector })),
        );
      });

    await expect(
      createOpenAIEmbeddingProvider("secret", fetcher).embed(texts),
    ).resolves.toHaveLength(65);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).input,
    ).toHaveLength(64);
    expect(
      JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).input,
    ).toHaveLength(1);
  });

  it("rejects malformed, misdimensioned, or mismatched model responses", async () => {
    const badDimension = createOpenAIEmbeddingProvider(
      "secret",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          apiResponse([{ index: 0, embedding: vector.slice(1) }]),
        ),
    );
    await expect(badDimension.embed(["claim"])).rejects.toMatchObject({
      code: "EMBEDDING_DIMENSION_MISMATCH",
      retryable: false,
    });

    const wrongModel = createOpenAIEmbeddingProvider(
      "secret",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          apiResponse([{ index: 0, embedding: vector }], "other-model"),
        ),
    );
    await expect(wrongModel.embed(["claim"])).rejects.toMatchObject({
      code: "EMBEDDING_RESPONSE_INVALID",
    });
  });

  it("handles missing keys, invalid inputs, and retryable API failures without leaking details", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createOpenAIEmbeddingProvider(undefined, fetcher).embed(["claim"]),
    ).rejects.toMatchObject({
      code: "OPENAI_NOT_CONFIGURED",
      retryable: false,
    });
    await expect(
      createOpenAIEmbeddingProvider("secret", fetcher).embed(["   "]),
    ).rejects.toMatchObject({ code: "EMBEDDING_INPUT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();

    const limited = createOpenAIEmbeddingProvider(
      "secret",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("sensitive provider text", { status: 429 }),
        ),
    );
    const caught = await limited
      .embed(["claim"])
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(EmbeddingProviderError);
    expect(caught).toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      retryable: true,
    });
    expect(String(caught)).not.toContain("sensitive provider text");
  });
});
