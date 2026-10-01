import { z } from "zod";

export const EMBEDDING_PROVIDER = "openai";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_VERSION = "openai-text-embedding-3-small-1536-v1";
export const EMBEDDING_DIMENSIONS = 1536;
export const MAX_EMBEDDING_BATCH_SIZE = 64;

export const embeddingVectorSchema = z
  .array(z.number().finite())
  .length(EMBEDDING_DIMENSIONS);

export const embeddingInputSchema = z
  .array(z.string().trim().min(1).max(16_000))
  .min(1)
  .max(2_048);

export function serializeEmbedding(vector: readonly number[]) {
  return `[${vector.join(",")}]`;
}
