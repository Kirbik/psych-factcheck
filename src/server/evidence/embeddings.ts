import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  EMBEDDING_VERSION,
  embeddingVectorSchema,
  serializeEmbedding,
} from "../ai/embeddings.ts";
import type { EmbeddingProvider } from "../ai/providers.ts";
import type { Database } from "../../types/database.ts";

type EvidenceClient = SupabaseClient<Database>;

export class EvidenceEmbeddingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "EvidenceEmbeddingError";
  }
}

function assertSupportedProvider(provider: EmbeddingProvider) {
  if (
    provider.provider !== EMBEDDING_PROVIDER ||
    provider.model !== EMBEDDING_MODEL ||
    provider.version !== EMBEDDING_VERSION ||
    provider.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new EvidenceEmbeddingError("EMBEDDING_MODEL_VERSION_UNSUPPORTED");
  }
}

function contentDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validatedVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
) {
  if (vectors.length !== expectedCount)
    throw new EvidenceEmbeddingError("EMBEDDING_RESPONSE_INVALID");
  return vectors.map((vector) => {
    const parsed = embeddingVectorSchema.safeParse(vector);
    if (!parsed.success)
      throw new EvidenceEmbeddingError("EMBEDDING_DIMENSION_MISMATCH");
    return serializeEmbedding(parsed.data);
  });
}

export async function embedEvidenceChunks(
  client: EvidenceClient,
  provider: EmbeddingProvider,
  chunks: readonly { readonly id: string; readonly content: string }[],
) {
  assertSupportedProvider(provider);
  if (chunks.length === 0) return;
  const vectors = validatedVectors(
    await provider.embed(chunks.map((chunk) => chunk.content)),
    chunks.length,
  );
  const rows = chunks.map((chunk, index) => ({
    evidence_chunk_id: chunk.id,
    provider: provider.provider,
    model: provider.model,
    embedding_version: provider.version,
    dimensions: provider.dimensions,
    content_sha256: contentDigest(chunk.content),
    embedding: vectors[index]!,
  }));
  const { error } = await client
    .from("evidence_embeddings")
    .upsert(rows, { onConflict: "evidence_chunk_id,embedding_version" });
  if (error) throw new EvidenceEmbeddingError("EVIDENCE_EMBEDDING_SAVE_FAILED");
}

export async function embedClaims(
  client: EvidenceClient,
  provider: EmbeddingProvider,
  claims: readonly { readonly id: string; readonly normalizedText: string }[],
) {
  assertSupportedProvider(provider);
  if (claims.length === 0) return;
  const vectors = validatedVectors(
    await provider.embed(claims.map((claim) => claim.normalizedText)),
    claims.length,
  );
  const rows = claims.map((claim, index) => ({
    claim_id: claim.id,
    provider: provider.provider,
    model: provider.model,
    embedding_version: provider.version,
    dimensions: provider.dimensions,
    content_sha256: contentDigest(claim.normalizedText),
    embedding: vectors[index]!,
  }));
  const { error } = await client
    .from("claim_embeddings")
    .upsert(rows, { onConflict: "claim_id,embedding_version" });
  if (error) throw new EvidenceEmbeddingError("CLAIM_EMBEDDING_SAVE_FAILED");
}
