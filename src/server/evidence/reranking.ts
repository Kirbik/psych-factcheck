import "server-only";

import { z } from "zod";
import type {
  EvidencePackage,
  EvidenceItem,
  ExtractedClaim,
  PublicationReference,
} from "../ai/providers.ts";
import type { EvidenceCandidate, EvidenceSearchResult } from "./search.ts";

export const EVIDENCE_RERANKING_VERSION = "evidence-reranking-v2";
export const SUPPORTED_EVIDENCE_RERANKING_VERSIONS = [
  EVIDENCE_RERANKING_VERSION,
  "evidence-reranking-v1",
] as const;
export const MAX_EVIDENCE_PACKAGE_SIZE = 5;
export const MAX_CHUNKS_PER_SOURCE = 2;
const RETRIEVAL_SCORE_WEIGHT = 0.6;
const DIRECT_TERM_COVERAGE_WEIGHT = 0.4;

const commonTerms = new Set([
  "about",
  "after",
  "does",
  "from",
  "have",
  "into",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "were",
  "what",
  "when",
  "which",
  "with",
  "would",
  "для",
  "как",
  "или",
  "это",
  "что",
]);

const rerankedSchema = z
  .array(
    z
      .object({
        chunkId: z.string().min(1),
        relevanceScore: z.number().finite().min(0).max(1),
      })
      .strict(),
  )
  .max(100);

export interface RerankedEvidenceCandidate {
  readonly chunkId: string;
  readonly relevanceScore: number;
}

export interface EvidenceReranker {
  rerank(
    normalizedClaim: string,
    candidates: readonly EvidenceCandidate[],
  ): Promise<readonly RerankedEvidenceCandidate[]>;
}

function terms(text: string): ReadonlySet<string> {
  return new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (term) => term.length > 2 && !commonTerms.has(term),
    ),
  );
}

function lexicalCoverage(claimTerms: ReadonlySet<string>, content: string) {
  if (claimTerms.size === 0) return 0;
  const contentTerms = terms(content);
  let matches = 0;
  for (const term of claimTerms) {
    if (contentTerms.has(term)) matches += 1;
  }
  return matches / claimTerms.size;
}

export const deterministicEvidenceReranker: EvidenceReranker = {
  async rerank(normalizedClaim, candidates) {
    const claimTerms = terms(normalizedClaim);
    return candidates
      .map((candidate) => {
        const retrievalScore = candidate.similarity;
        const directTermCoverage = lexicalCoverage(
          claimTerms,
          candidate.content,
        );
        return {
          chunkId: candidate.chunkId,
          relevanceScore:
            RETRIEVAL_SCORE_WEIGHT * retrievalScore +
            DIRECT_TERM_COVERAGE_WEIGHT * directTermCoverage,
          retrievalScore,
        };
      })
      .sort(
        (left, right) =>
          right.relevanceScore - left.relevanceScore ||
          right.retrievalScore - left.retrievalScore ||
          left.chunkId.localeCompare(right.chunkId),
      )
      .map(({ chunkId, relevanceScore }) => ({ chunkId, relevanceScore }));
  },
};

export class EvidenceRerankingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "EvidenceRerankingError";
  }
}

function toEvidenceItem(
  candidate: EvidenceCandidate,
  retrievalScore: number,
  relevanceScore: number,
): EvidenceItem {
  return {
    sourceId: candidate.sourceId,
    chunkId: candidate.chunkId,
    chunkKey: candidate.chunkKey,
    text: candidate.content,
    language: candidate.language,
    locator: candidate.locator,
    source: candidate.source,
    retrievalScore,
    relevanceScore,
    ...(candidate.retrievalScoreKind
      ? { retrievalScoreKind: candidate.retrievalScoreKind }
      : {}),
    ...(candidate.attribution ? { attribution: candidate.attribution } : {}),
  };
}

export async function buildEvidencePackage(
  claim: ExtractedClaim,
  retrieval: EvidenceSearchResult & {
    readonly references?: readonly PublicationReference[];
    readonly externalSearchVersion?: string;
  },
  reranker: EvidenceReranker = deterministicEvidenceReranker,
): Promise<EvidencePackage> {
  if (claim.normalized.trim().length === 0 || claim.normalized.length > 1_200)
    throw new EvidenceRerankingError("EVIDENCE_RERANKING_CLAIM_INVALID");

  let ranked: readonly RerankedEvidenceCandidate[];
  try {
    ranked = await reranker.rerank(claim.normalized, retrieval.candidates);
  } catch {
    throw new EvidenceRerankingError("EVIDENCE_RERANKING_FAILED");
  }

  const validated = rerankedSchema.safeParse(ranked);
  const candidatesById = new Map(
    retrieval.candidates.map((candidate) => [candidate.chunkId, candidate]),
  );
  if (
    !validated.success ||
    validated.data.length !== retrieval.candidates.length ||
    new Set(validated.data.map((item) => item.chunkId)).size !==
      retrieval.candidates.length ||
    validated.data.some((item) => !candidatesById.has(item.chunkId))
  ) {
    throw new EvidenceRerankingError("EVIDENCE_RERANKING_RESPONSE_INVALID");
  }

  if (
    validated.data.some(
      (item) => !Number.isFinite(candidatesById.get(item.chunkId)?.similarity),
    )
  ) {
    throw new EvidenceRerankingError("EVIDENCE_RERANKING_RESPONSE_INVALID");
  }

  const seenContent = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const selected: EvidenceItem[] = [];
  for (const item of validated.data) {
    const candidate = candidatesById.get(item.chunkId);
    if (!candidate) {
      throw new EvidenceRerankingError("EVIDENCE_RERANKING_RESPONSE_INVALID");
    }
    const normalizedContent = candidate.content
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const sourceCount = sourceCounts.get(candidate.sourceId) ?? 0;
    if (
      seenContent.has(normalizedContent) ||
      sourceCount >= MAX_CHUNKS_PER_SOURCE
    ) {
      continue;
    }
    seenContent.add(normalizedContent);
    sourceCounts.set(candidate.sourceId, sourceCount + 1);
    selected.push(
      toEvidenceItem(candidate, candidate.similarity, item.relevanceScore),
    );
    if (selected.length === MAX_EVIDENCE_PACKAGE_SIZE) break;
  }

  const sourceCount = new Set(selected.map((item) => item.sourceId)).size;
  const coverage =
    selected.length === 0
      ? "none"
      : selected.length < 2 || sourceCount < 2
        ? "limited"
        : "multi_source";
  const warnings = [...retrieval.warnings];
  if (selected.length === 0 && !warnings.includes("no_matching_evidence")) {
    warnings.push("no_matching_evidence");
  } else if (coverage === "limited") {
    warnings.push("limited_evidence_coverage");
  }

  return {
    schemaVersion: "evidence-package-v2",
    claim,
    evidence: selected,
    retrievalVersion: retrieval.retrievalVersion,
    rerankingVersion: EVIDENCE_RERANKING_VERSION,
    coverage,
    warnings,
    ...(retrieval.references ? { references: retrieval.references } : {}),
    trace: {
      retrieval: {
        provider: retrieval.provider,
        model: retrieval.model,
        filters: retrieval.filters,
      },
      candidateCount: retrieval.candidates.length,
      selectedChunkIds: selected.map((item) => item.chunkId),
      maximumEvidence: MAX_EVIDENCE_PACKAGE_SIZE,
      maximumChunksPerSource: MAX_CHUNKS_PER_SOURCE,
      ...(retrieval.externalSearchVersion
        ? { externalSearchVersion: retrieval.externalSearchVersion }
        : {}),
    },
  };
}
