import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  EMBEDDING_VERSION,
  embeddingVectorSchema,
  serializeEmbedding,
} from "@/server/ai/embeddings";
import type { EmbeddingProvider } from "@/server/ai/providers";
import type { Database } from "@/types/database";

type EvidenceClient = SupabaseClient<Database>;

export const EVIDENCE_RETRIEVAL_VERSION = "evidence-retrieval-v1";

const sourceTypes = [
  "journal_article",
  "systematic_review",
  "meta_analysis",
  "commentary",
] as const;

const searchOptionsSchema = z
  .object({
    language: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
    sourceTypes: z
      .array(z.enum(sourceTypes))
      .min(1)
      .max(sourceTypes.length)
      .optional(),
    publishedAfter: z.iso.date().optional(),
    publishedBefore: z.iso.date().optional(),
    limit: z.number().int().min(1).max(100).default(10),
  })
  .strict()
  .superRefine((filters, context) => {
    if (
      filters.publishedAfter &&
      filters.publishedBefore &&
      filters.publishedAfter > filters.publishedBefore
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAfter"],
        message: "Publication date range is inverted",
      });
    }
  });

const matchResultSchema = z.array(
  z
    .object({
      chunk_id: z.uuid(),
      source_id: z.uuid(),
      chunk_key: z.string().min(1),
      content: z.string().min(1),
      language: z.string().min(2),
      locator: z.string().min(1),
      source_key: z.string().min(1),
      title: z.string().min(1),
      authors: z.array(z.string()),
      journal: z.string().min(1),
      published_at: z.iso.date(),
      source_type: z.enum(sourceTypes),
      canonical_url: z.url().refine((value) => value.startsWith("https://")),
      similarity: z.number().finite().min(-1).max(1),
    })
    .strict(),
);

export type EvidenceSearchFilters = z.input<typeof searchOptionsSchema>;

export interface EvidenceCandidate {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly chunkKey: string;
  readonly content: string;
  readonly language: string;
  readonly locator: string;
  readonly source: {
    readonly key: string;
    readonly title: string;
    readonly authors: readonly string[];
    readonly journal: string;
    readonly publishedAt: string;
    readonly type: (typeof sourceTypes)[number];
    readonly canonicalUrl: string;
  };
  readonly similarity: number;
}

export class EvidenceSearchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EvidenceSearchError";
  }
}

export async function searchEvidence(
  client: EvidenceClient,
  provider: EmbeddingProvider,
  claimText: string,
  rawFilters: EvidenceSearchFilters = {},
) {
  const filters = searchOptionsSchema.safeParse(rawFilters);
  if (
    !filters.success ||
    claimText.trim().length === 0 ||
    claimText.length > 1_200
  )
    throw new EvidenceSearchError("EVIDENCE_SEARCH_INPUT_INVALID");
  if (
    provider.provider !== EMBEDDING_PROVIDER ||
    provider.model !== EMBEDDING_MODEL ||
    provider.version !== EMBEDDING_VERSION ||
    provider.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new EvidenceSearchError("EMBEDDING_MODEL_VERSION_UNSUPPORTED");
  }

  const [rawVector] = await provider.embed([claimText]);
  const vector = embeddingVectorSchema.safeParse(rawVector);
  if (!vector.success)
    throw new EvidenceSearchError("EMBEDDING_DIMENSION_MISMATCH");

  const { data, error } = await client.rpc("match_evidence_chunks_v1", {
    p_query_embedding: serializeEmbedding(vector.data),
    p_embedding_model: provider.model,
    p_embedding_version: provider.version,
    p_language: filters.data.language ?? null,
    p_source_types: filters.data.sourceTypes ?? null,
    p_published_after: filters.data.publishedAfter ?? null,
    p_published_before: filters.data.publishedBefore ?? null,
    p_match_count: filters.data.limit,
  });
  if (error) throw new EvidenceSearchError("EVIDENCE_SEARCH_FAILED");

  const parsed = matchResultSchema.safeParse(data);
  if (!parsed.success)
    throw new EvidenceSearchError("EVIDENCE_SEARCH_RESPONSE_INVALID");
  const candidates: EvidenceCandidate[] = parsed.data.map((row) => ({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    chunkKey: row.chunk_key,
    content: row.content,
    language: row.language,
    locator: row.locator,
    source: {
      key: row.source_key,
      title: row.title,
      authors: row.authors,
      journal: row.journal,
      publishedAt: row.published_at,
      type: row.source_type,
      canonicalUrl: row.canonical_url,
    },
    similarity: row.similarity,
  }));

  return {
    retrievalVersion: EVIDENCE_RETRIEVAL_VERSION,
    provider: provider.provider,
    model: provider.model,
    embeddingVersion: provider.version,
    filters: {
      sourceStatus: "active" as const,
      language: filters.data.language ?? null,
      sourceTypes: filters.data.sourceTypes ?? null,
      publishedAfter: filters.data.publishedAfter ?? null,
      publishedBefore: filters.data.publishedBefore ?? null,
      limit: filters.data.limit,
    },
    candidates,
    warnings: candidates.length === 0 ? ["no_matching_evidence"] : [],
  };
}
