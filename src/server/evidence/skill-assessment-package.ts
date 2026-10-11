import type { EvidencePackage, ExtractedClaim } from "../ai/providers";

export const SKILL_ASSESSMENT_RETRIEVAL_VERSION =
  "psychology-skill-no-search-v1";
export const SKILL_ASSESSMENT_RERANKING_VERSION = "no-reranking-v1";

/** Build an auditable empty package without querying an external or local corpus. */
export function buildSkillAssessmentPackage(
  claim: ExtractedClaim,
): EvidencePackage {
  return {
    schemaVersion: "evidence-package-v2",
    claim,
    evidence: [],
    retrievalVersion: SKILL_ASSESSMENT_RETRIEVAL_VERSION,
    rerankingVersion: SKILL_ASSESSMENT_RERANKING_VERSION,
    coverage: "none",
    warnings: ["scientific_search_not_performed"],
    trace: {
      retrieval: {
        provider: "none",
        model: "none",
        filters: {
          sourceStatus: "not_used",
          language: null,
          sourceTypes: null,
          publishedAfter: null,
          publishedBefore: null,
          limit: 1,
        },
      },
      candidateCount: 0,
      selectedChunkIds: [],
      maximumEvidence: 5,
      maximumChunksPerSource: 1,
    },
  };
}
