import { z } from "zod";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  EMBEDDING_VERSION,
  embeddingInputSchema,
  embeddingVectorSchema,
  MAX_EMBEDDING_BATCH_SIZE,
} from "./embeddings";
import type { EmbeddingProvider } from "./providers";

const embeddingResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          embedding: z.array(z.number().finite()),
        })
        .passthrough(),
    ),
    model: z.string(),
  })
  .passthrough();

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EmbeddingProviderError";
  }
}

export function createOpenAIEmbeddingProvider(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): EmbeddingProvider {
  return {
    provider: EMBEDDING_PROVIDER,
    model: EMBEDDING_MODEL,
    version: EMBEDDING_VERSION,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (!apiKey)
        throw new EmbeddingProviderError("OPENAI_NOT_CONFIGURED", false);
      if (texts.length === 0) return [];
      const parsedTexts = embeddingInputSchema.safeParse(texts);
      if (!parsedTexts.success)
        throw new EmbeddingProviderError("EMBEDDING_INPUT_INVALID", false);

      const vectors: (readonly number[])[] = [];
      for (
        let offset = 0;
        offset < parsedTexts.data.length;
        offset += MAX_EMBEDDING_BATCH_SIZE
      ) {
        const batch = parsedTexts.data.slice(
          offset,
          offset + MAX_EMBEDDING_BATCH_SIZE,
        );
        let response: Response;
        try {
          response = await fetcher("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: EMBEDDING_MODEL,
              input: batch,
              encoding_format: "float",
            }),
            signal: AbortSignal.timeout(60_000),
          });
        } catch {
          throw new EmbeddingProviderError("OPENAI_UNAVAILABLE", true);
        }
        if (!response.ok) {
          const retryable =
            response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500;
          throw new EmbeddingProviderError(
            retryable ? "OPENAI_UNAVAILABLE" : "OPENAI_REQUEST_REJECTED",
            retryable,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new EmbeddingProviderError("EMBEDDING_RESPONSE_INVALID", false);
        }
        const parsed = embeddingResponseSchema.safeParse(payload);
        if (
          !parsed.success ||
          parsed.data.model !== EMBEDDING_MODEL ||
          parsed.data.data.length !== batch.length
        )
          throw new EmbeddingProviderError("EMBEDDING_RESPONSE_INVALID", false);

        const ordered = new Array<readonly number[]>(batch.length);
        for (const item of parsed.data.data) {
          if (item.index >= batch.length || ordered[item.index] !== undefined)
            throw new EmbeddingProviderError(
              "EMBEDDING_RESPONSE_INVALID",
              false,
            );
          const vector = embeddingVectorSchema.safeParse(item.embedding);
          if (!vector.success)
            throw new EmbeddingProviderError(
              "EMBEDDING_DIMENSION_MISMATCH",
              false,
            );
          ordered[item.index] = vector.data;
        }
        if (ordered.some((vector) => vector === undefined))
          throw new EmbeddingProviderError("EMBEDDING_RESPONSE_INVALID", false);
        vectors.push(...ordered);
      }
      return vectors;
    },
  };
}
