import type { Verdict } from "@/types/fact-check";

export interface TranscriptSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface ExtractedClaim {
  readonly original: string;
  readonly normalized: string;
  readonly timestampSeconds: number;
}

export interface EvidenceItem {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly text: string;
  readonly relevanceScore: number;
}

export interface EvidencePackage {
  readonly claim: ExtractedClaim;
  readonly evidence: readonly EvidenceItem[];
}

export interface FactCheckJudgment {
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly explanation: string;
  readonly citedChunkIds: readonly string[];
}

export interface LLMProvider {
  extractClaims(
    transcript: readonly TranscriptSegment[],
  ): Promise<readonly ExtractedClaim[]>;
  judge(evidencePackage: EvidencePackage): Promise<FactCheckJudgment>;
}

export interface TranscriptionProvider {
  transcribe(input: {
    readonly storagePath: string;
  }): Promise<readonly TranscriptSegment[]>;
}

export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
