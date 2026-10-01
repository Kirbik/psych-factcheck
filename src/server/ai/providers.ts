import type { Verdict } from "@/types/fact-check";

export interface TranscriptSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface ExtractedClaim {
  readonly original: string;
  readonly normalized: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly claimType: ClaimType;
}

export const claimTypes = [
  "descriptive_prevalence",
  "causal_mechanistic",
  "intervention",
  "diagnostic_classification",
  "prognostic",
  "consensus_theory",
  "historical",
] as const;

export type ClaimType = (typeof claimTypes)[number];

export interface ClaimExtractionResult {
  readonly extractionVersion: string;
  readonly provider: "openai";
  readonly model: string;
  readonly instructionsVersion: string;
  readonly schemaVersion: string;
  readonly claims: readonly ExtractedClaim[];
}

export interface ClaimExtractionProvider {
  extractClaims(
    transcript: readonly TranscriptSegment[],
  ): Promise<ClaimExtractionResult>;
}

export interface EvidenceItem {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly chunkKey: string;
  readonly text: string;
  readonly language: string;
  readonly locator: string;
  readonly source: {
    readonly key: string;
    readonly title: string;
    readonly authors: readonly string[];
    readonly journal: string;
    readonly publishedAt: string;
    readonly type:
      | "journal_article"
      | "systematic_review"
      | "meta_analysis"
      | "commentary";
    readonly canonicalUrl: string;
  };
  readonly retrievalScore: number;
  readonly relevanceScore: number;
}

export interface EvidencePackage {
  readonly claim: ExtractedClaim;
  readonly evidence: readonly EvidenceItem[];
  readonly retrievalVersion: string;
  readonly rerankingVersion: string;
  readonly coverage: "none" | "limited" | "multi_source";
  readonly warnings: readonly string[];
  readonly trace: {
    readonly retrieval: {
      readonly provider: string;
      readonly model: string;
      readonly embeddingVersion: string;
      readonly filters: {
        readonly sourceStatus: "active";
        readonly language: string | null;
        readonly sourceTypes: readonly (
          | "journal_article"
          | "systematic_review"
          | "meta_analysis"
          | "commentary"
        )[] | null;
        readonly publishedAfter: string | null;
        readonly publishedBefore: string | null;
        readonly limit: number;
      };
    };
    readonly candidateCount: number;
    readonly selectedChunkIds: readonly string[];
    readonly maximumEvidence: number;
    readonly maximumChunksPerSource: number;
  };
}

export interface FactCheckJudgment {
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly explanation: string;
  readonly citedChunkIds: readonly string[];
}

export interface LLMProvider extends ClaimExtractionProvider {
  judge(evidencePackage: EvidencePackage): Promise<FactCheckJudgment>;
}

export interface TranscriptionProvider {
  transcribe(input: {
    readonly fileName: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }): Promise<TranscriptionResult>;
}

export interface TranscriptionResult {
  readonly language: string | null;
  readonly segments: readonly TranscriptSegment[];
}

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
