import { z } from "zod";
import {
  claimTypes,
  type EvidencePackage,
  type FactCheckJudgment,
} from "./providers";
import { verdicts } from "../../types/fact-check";

export const FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v1";
export const FACT_CHECK_JUDGMENT_SCHEMA_VERSION =
  "fact-check-judgment-schema-v1";
export const FACT_CHECK_JUDGMENT_MODEL = "gpt-4o-mini";
export const MAX_JUDGMENT_EVIDENCE_ITEMS = 5;
export const MAX_JUDGMENT_LIMITATIONS = 8;

const sourceTypeSchema = z.enum([
  "journal_article",
  "systematic_review",
  "meta_analysis",
  "commentary",
]);

const extractedClaimSchema = z
  .object({
    original: z.string().min(1).max(1_200),
    normalized: z.string().min(1).max(1_200),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative(),
    claimType: z.enum(claimTypes),
  })
  .strict()
  .refine((claim) => claim.endSeconds >= claim.startSeconds);

const evidenceItemSchema = z
  .object({
    sourceId: z.uuid(),
    chunkId: z.uuid(),
    chunkKey: z.string().min(1).max(200),
    text: z.string().min(1).max(20_000),
    language: z.string().min(1).max(20),
    locator: z.string().min(1).max(500),
    source: z
      .object({
        key: z.string().min(1).max(200),
        title: z.string().min(1).max(1_000),
        authors: z.array(z.string().min(1).max(500)).max(100),
        journal: z.string().max(500),
        publishedAt: z.string().max(100),
        type: sourceTypeSchema,
        canonicalUrl: z.url().max(2_000),
      })
      .strict(),
    retrievalScore: z.number().finite().min(-1).max(1),
    relevanceScore: z.number().finite().min(0).max(1),
  })
  .strict();

export const evidencePackageSchema = z
  .object({
    claim: extractedClaimSchema,
    evidence: z.array(evidenceItemSchema).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
    retrievalVersion: z.string().min(1).max(100),
    rerankingVersion: z.string().min(1).max(100),
    coverage: z.enum(["none", "limited", "multi_source"]),
    warnings: z.array(z.string().min(1).max(200)).max(20),
    trace: z
      .object({
        retrieval: z
          .object({
            provider: z.string().min(1).max(100),
            model: z.string().min(1).max(200),
            embeddingVersion: z.string().min(1).max(100),
            filters: z
              .object({
                sourceStatus: z.literal("active"),
                language: z.string().max(20).nullable(),
                sourceTypes: z.array(sourceTypeSchema).max(10).nullable(),
                publishedAfter: z.string().max(100).nullable(),
                publishedBefore: z.string().max(100).nullable(),
                limit: z.number().int().min(1).max(100),
              })
              .strict(),
          })
          .strict(),
        candidateCount: z.number().int().min(0).max(100),
        selectedChunkIds: z.array(z.uuid()).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
        maximumEvidence: z.literal(MAX_JUDGMENT_EVIDENCE_ITEMS),
        maximumChunksPerSource: z.number().int().min(1).max(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((evidencePackage, context) => {
    const itemIds = evidencePackage.evidence.map((item) => item.chunkId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({ code: "custom", message: "Duplicate evidence chunk" });
    }
    if (
      itemIds.length !== evidencePackage.trace.selectedChunkIds.length ||
      itemIds.some(
        (chunkId, index) =>
          chunkId !== evidencePackage.trace.selectedChunkIds[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence package trace does not match its passages",
      });
    }
    if (evidencePackage.trace.candidateCount < itemIds.length) {
      context.addIssue({
        code: "custom",
        message: "Evidence package candidate count is inconsistent",
      });
    }
    if (itemIds.length === 0 && evidencePackage.coverage !== "none") {
      context.addIssue({
        code: "custom",
        message: "Empty evidence package must have none coverage",
      });
    }
  });

export const judgmentOutputSchema = z
  .object({
    verdict: z.enum(verdicts),
    confidence: z.number().finite().min(0).max(1),
    explanation: z.string().trim().min(1).max(4_000),
    limitations: z
      .array(z.string().trim().min(1).max(500))
      .max(MAX_JUDGMENT_LIMITATIONS),
    citations: z
      .array(
        z
          .object({
            chunk_id: z.uuid(),
            relation: z.enum(["supports", "qualifies", "contradicts"]),
            rationale: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .max(MAX_JUDGMENT_EVIDENCE_ITEMS),
  })
  .strict();

const factCheckJudgmentSchema = z
  .object({
    verdict: z.enum(verdicts),
    confidence: z.number().finite().min(0).max(1),
    explanation: z.string().trim().min(1).max(4_000),
    limitations: z
      .array(z.string().trim().min(1).max(500))
      .max(MAX_JUDGMENT_LIMITATIONS),
    citations: z
      .array(
        z
          .object({
            chunkId: z.uuid(),
            relation: z.enum(["supports", "qualifies", "contradicts"]),
            rationale: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .max(MAX_JUDGMENT_EVIDENCE_ITEMS),
  })
  .strict();

export class FactCheckJudgmentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FactCheckJudgmentError";
  }
}

export function validateEvidencePackage(input: unknown): EvidencePackage {
  const parsed = evidencePackageSchema.safeParse(input);
  if (!parsed.success) {
    throw new FactCheckJudgmentError("FACT_CHECK_EVIDENCE_PACKAGE_INVALID");
  }
  return parsed.data;
}

export function parseJudgmentOutput(input: unknown): FactCheckJudgment {
  const parsed = judgmentOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new FactCheckJudgmentError("FACT_CHECK_JUDGMENT_INVALID");
  }
  return {
    verdict: parsed.data.verdict,
    confidence: parsed.data.confidence,
    explanation: parsed.data.explanation,
    limitations: parsed.data.limitations,
    citations: parsed.data.citations.map((citation) => ({
      chunkId: citation.chunk_id,
      relation: citation.relation,
      rationale: citation.rationale,
    })),
  };
}

export function validateEvidenceBoundJudgment(
  evidencePackageInput: unknown,
  judgmentInput: unknown,
): {
  readonly evidencePackage: EvidencePackage;
  readonly judgment: FactCheckJudgment;
} {
  const evidencePackage = validateEvidencePackage(evidencePackageInput);
  const parsedJudgment = factCheckJudgmentSchema.safeParse(judgmentInput);
  if (!parsedJudgment.success) {
    throw new FactCheckJudgmentError("FACT_CHECK_JUDGMENT_INVALID");
  }

  const packageChunkIds = new Set(
    evidencePackage.evidence.map((item) => item.chunkId),
  );
  const citedChunkIds = parsedJudgment.data.citations.map(
    (citation) => citation.chunkId,
  );
  if (
    new Set(citedChunkIds).size !== citedChunkIds.length ||
    citedChunkIds.some((chunkId) => !packageChunkIds.has(chunkId))
  ) {
    throw new FactCheckJudgmentError("FACT_CHECK_CITATION_OUTSIDE_PACKAGE");
  }

  const requiresEvidenceCitation = [
    "SUPPORTED",
    "MOSTLY_SUPPORTED",
    "OVERSIMPLIFIED",
    "CONTRADICTED",
  ].includes(parsedJudgment.data.verdict);
  if (
    (evidencePackage.evidence.length === 0 &&
      parsedJudgment.data.verdict !== "INSUFFICIENT_EVIDENCE" &&
      parsedJudgment.data.verdict !== "UNVERIFIABLE") ||
    (requiresEvidenceCitation && citedChunkIds.length === 0)
  ) {
    throw new FactCheckJudgmentError("FACT_CHECK_EVIDENCE_REQUIRED");
  }

  return {
    evidencePackage,
    judgment: {
      verdict: parsedJudgment.data.verdict,
      confidence: parsedJudgment.data.confidence,
      explanation: parsedJudgment.data.explanation,
      limitations: parsedJudgment.data.limitations,
      citations: parsedJudgment.data.citations,
    },
  };
}
