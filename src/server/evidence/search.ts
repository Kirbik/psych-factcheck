import type { EvidenceItem, PublicationReference } from "../ai/providers";
export const EVIDENCE_RETRIEVAL_VERSION = "publication-search-v1";
// Historical reports only: these versions never enable a local search path.
export const SUPPORTED_EVIDENCE_RETRIEVAL_VERSIONS = [
  EVIDENCE_RETRIEVAL_VERSION,
  "evidence-retrieval-v2",
  "evidence-retrieval-v1",
] as const;
export interface EvidenceCandidate {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly chunkKey: string;
  readonly content: string;
  readonly language: string;
  readonly locator: string;
  readonly source: EvidenceItem["source"];
  readonly similarity: number;
  readonly retrievalScoreKind?: "provider_search_order";
  readonly attribution?: EvidenceItem["attribution"];
}
export interface EvidenceSearchResult {
  readonly retrievalVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly filters: {
    readonly sourceStatus: "active";
    readonly language: string | null;
    readonly sourceTypes: readonly EvidenceItem["source"]["type"][] | null;
    readonly publishedAfter: string | null;
    readonly publishedBefore: string | null;
    readonly limit: number;
  };
  readonly candidates: readonly EvidenceCandidate[];
  readonly warnings: readonly string[];
  readonly references?: readonly PublicationReference[];
  readonly externalSearchVersion?: string;
}
