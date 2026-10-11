import { z } from "zod";
import {
  claimTypes,
  type EvidencePackage,
  type FactCheckJudgment,
  type PsychologyEvidenceAssessment,
} from "./providers";
import { verdicts } from "../../types/fact-check";

export const FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v5";
export const PREVIOUS_FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v4";
export const LEGACY_FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v3";
export const OLDER_FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v2";
export const OLDEST_FACT_CHECK_JUDGMENT_VERSION = "fact-check-judgment-v1";
export const SUPPORTED_FACT_CHECK_JUDGMENT_VERSIONS = [
  FACT_CHECK_JUDGMENT_VERSION,
  PREVIOUS_FACT_CHECK_JUDGMENT_VERSION,
  LEGACY_FACT_CHECK_JUDGMENT_VERSION,
  OLDER_FACT_CHECK_JUDGMENT_VERSION,
  OLDEST_FACT_CHECK_JUDGMENT_VERSION,
] as const;
export const FACT_CHECK_JUDGMENT_SCHEMA_VERSION =
  "fact-check-judgment-schema-v4";
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

export const evidenceItemSchema = z
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
        publisher: z.string().max(1_000).optional(),
        doi: z.string().max(255).nullable().optional(),
        licenseCode: z.string().max(100).nullable().optional(),
        licenseUrl: z.url().nullable().optional(),
        publishedAt: z.string().max(100),
        type: sourceTypeSchema,
        canonicalUrl: z.url().max(2_000),
      })
      .strict(),
    retrievalScore: z.number().finite().min(-1).max(1),
    retrievalScoreKind: z
      .enum(["cosine_similarity", "provider_search_order"])
      .optional(),
    relevanceScore: z.number().finite().min(0).max(1),
    attribution: z
      .object({
        dataProvider: z.literal("europe-pmc"),
        providerVersion: z.string().min(1).max(100),
        externalId: z.string().min(1).max(40),
        availability: z.literal("open_access_full_text"),
        licenseCode: z.literal("CC-BY-4.0"),
        licenseUrl: z.url(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const evidencePackageSchema = z
  .object({
    schemaVersion: z.literal("evidence-package-v2").optional(),
    claim: extractedClaimSchema,
    evidence: z.array(evidenceItemSchema).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
    retrievalVersion: z.string().min(1).max(100),
    rerankingVersion: z.string().min(1).max(100),
    coverage: z.enum(["none", "limited", "multi_source"]),
    warnings: z.array(z.string().min(1).max(200)).max(20),
    references: z
      .array(
        z
          .object({
            id: z.string().min(1).max(255),
            title: z.string().min(1).max(1_000),
            authors: z.array(z.string().min(1).max(300)).max(100),
            year: z
              .string()
              .regex(/^\d{4}$/)
              .nullable(),
            doi: z.string().max(255).nullable(),
            url: z.url(),
            dataProvider: z.enum(["europe-pmc", "crossref"]),
            providerVersion: z.string().min(1).max(100),
            availability: z.enum(["open_access_full_text", "metadata_only"]),
            licenseUrl: z.url().nullable(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    trace: z
      .object({
        retrieval: z
          .object({
            provider: z.string().min(1).max(100),
            model: z.string().min(1).max(200),
            embeddingVersion: z.string().min(1).max(100).optional(),
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
        externalSearchVersion: z.string().min(1).max(100).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((evidencePackage, context) => {
    if (evidencePackage.retrievalVersion === "publication-search-v1") {
      if (evidencePackage.schemaVersion !== "evidence-package-v2") {
        context.addIssue({
          code: "custom",
          message: "Publication package schema version missing",
        });
      }
      for (const item of evidencePackage.evidence) {
        if (
          !item.attribution ||
          item.text.length > 1000 ||
          item.text.length < 40 ||
          item.source.licenseCode !== "CC-BY-4.0" ||
          item.source.licenseUrl !==
            "https://creativecommons.org/licenses/by/4.0/"
        ) {
          context.addIssue({
            code: "custom",
            message: "Publication evidence lacks approved audit rights",
          });
        }
      }
    }
    for (const [index, item] of evidencePackage.evidence.entries()) {
      if (
        item.attribution &&
        item.attribution.licenseUrl !==
          "https://creativecommons.org/licenses/by/4.0/"
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "attribution", "licenseUrl"],
          message:
            "Full-text evidence license does not match its approved code",
        });
      }
    }
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

const psychologyClaimTypes = [
  "factual", "causal", "predictive", "intervention_effect",
  "practical_advice", "normative", "metaphor", "unclear",
] as const;
const psychologyVerdicts = [
  "supported", "false", "misleading", "complicated",
  "unsupported", "unknown", "not_empirical",
] as const;
const evidenceStrengths = [
  "high", "moderate", "low", "very_low", "insufficient", "not_applicable",
] as const;
const assessmentConfidences = ["high", "moderate", "low"] as const;

export const psychologyEvidenceAssessmentSchema = z.object({
  claimType: z.enum(psychologyClaimTypes),
  researchVerdict: z.enum(psychologyVerdicts),
  evidenceStrength: z.enum(evidenceStrengths),
  confidence: z.enum(assessmentConfidences),
  shortConclusion: z.string().trim().min(1).max(600),
  reasoning: z.string().trim().min(1).max(1_700),
  caveats: z.array(z.string().trim().min(1).max(180)).max(6),
  neededForAssessment: z.string().trim().min(1).max(350),
}).strict();

const rawJudgmentSchema = z.object({
  claim_type: z.enum(psychologyClaimTypes),
  verdict: z.enum(psychologyVerdicts),
  evidence_strength: z.enum(evidenceStrengths),
  assessment_confidence: z.enum(assessmentConfidences),
  short_conclusion: z.string().trim().min(1).max(600),
  reasoning: z.string().trim().min(1).max(1_700),
  caveats: z.array(z.string().trim().min(1).max(180)).max(6),
  needed_for_assessment: z.string().trim().min(1).max(350),
  citations: z.array(z.object({
    chunk_id: z.uuid(),
    relation: z.enum(["supports", "qualifies", "contradicts"]),
    rationale: z.string().trim().min(1).max(600),
  }).strict()).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
}).strict();

const legacyFactCheckJudgmentSchema = z.object({
  verdict: z.enum(verdicts),
  confidence: z.number().finite().min(0).max(1),
  assessment: z.null().optional(),
  explanation: z.string().trim().min(1).max(4_000),
  limitations: z.array(z.string().trim().min(1).max(500)).max(MAX_JUDGMENT_LIMITATIONS),
  citations: z.array(z.object({
    chunkId: z.uuid(),
    relation: z.enum(["supports", "qualifies", "contradicts"]),
    rationale: z.string().trim().min(1).max(600),
  }).strict()).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
}).strict();

const currentFactCheckJudgmentSchema = z.object({
  verdict: z.enum(verdicts),
  confidence: z.null(),
  assessment: psychologyEvidenceAssessmentSchema,
  explanation: z.string().trim().min(1).max(4_000),
  limitations: z.array(z.string().trim().min(1).max(500)).max(MAX_JUDGMENT_LIMITATIONS),
  citations: z.array(z.object({
    chunkId: z.uuid(),
    relation: z.enum(["supports", "qualifies", "contradicts"]),
    rationale: z.string().trim().min(1).max(600),
  }).strict()).max(MAX_JUDGMENT_EVIDENCE_ITEMS),
}).strict();

const factCheckJudgmentSchema = z.union([
  currentFactCheckJudgmentSchema,
  legacyFactCheckJudgmentSchema,
]);

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

function appVerdictForPsychologyVerdict(
  verdict: (typeof psychologyVerdicts)[number],
): FactCheckJudgment["verdict"] {
  switch (verdict) {
    case "supported": return "SUPPORTED";
    case "false": return "CONTRADICTED";
    case "misleading": return "OVERSIMPLIFIED";
    case "complicated": return "MOSTLY_SUPPORTED";
    case "unsupported": return "INSUFFICIENT_EVIDENCE";
    case "unknown": return "INSUFFICIENT_EVIDENCE";
    case "not_empirical": return "UNVERIFIABLE";
  }
}

function assessmentExplanation(assessment: PsychologyEvidenceAssessment) {
  return [
    assessment.shortConclusion,
    assessment.reasoning,
    ...assessment.caveats.map((caveat) => "Оговорка: " + caveat),
    "Для уверенной оценки нужно: " + assessment.neededForAssessment,
  ].join("\n\n");
}

export function parseJudgmentOutput(input: unknown): FactCheckJudgment {
  const parsed = rawJudgmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new FactCheckJudgmentError("FACT_CHECK_JUDGMENT_INVALID");
  }
  const assessment: PsychologyEvidenceAssessment = {
    claimType: parsed.data.claim_type,
    researchVerdict: parsed.data.verdict,
    evidenceStrength: parsed.data.evidence_strength,
    confidence: parsed.data.assessment_confidence,
    shortConclusion: parsed.data.short_conclusion,
    reasoning: parsed.data.reasoning,
    caveats: parsed.data.caveats,
    neededForAssessment: parsed.data.needed_for_assessment,
  };
  const explanation = assessmentExplanation(assessment);
  if (explanation.length > 4_000) {
    throw new FactCheckJudgmentError("FACT_CHECK_JUDGMENT_INVALID");
  }
  return {
    verdict: appVerdictForPsychologyVerdict(assessment.researchVerdict),
    confidence: null,
    assessment,
    explanation,
    limitations: assessment.caveats,
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
  const citations = parsedJudgment.data.citations;
  const citedChunkIds = citations.map((citation) => citation.chunkId);
  if (
    new Set(citedChunkIds).size !== citedChunkIds.length ||
    citedChunkIds.some((chunkId) => !packageChunkIds.has(chunkId))
  ) {
    throw new FactCheckJudgmentError("FACT_CHECK_CITATION_OUTSIDE_PACKAGE");
  }

  const requiresEvidenceCitation = [
    "SUPPORTED", "MOSTLY_SUPPORTED", "OVERSIMPLIFIED", "CONTRADICTED",
  ].includes(parsedJudgment.data.verdict);
  if (
    (evidencePackage.evidence.length === 0 &&
      parsedJudgment.data.verdict !== "INSUFFICIENT_EVIDENCE" &&
      parsedJudgment.data.verdict !== "UNVERIFIABLE") ||
    (requiresEvidenceCitation && citedChunkIds.length === 0)
  ) {
    throw new FactCheckJudgmentError("FACT_CHECK_EVIDENCE_REQUIRED");
  }

  if ("assessment" in parsedJudgment.data && parsedJudgment.data.assessment) {
    const assessment = parsedJudgment.data.assessment;
    if (
      assessment.researchVerdict === "false" &&
      !citations.some((citation) => citation.relation === "contradicts")
    ) {
      throw new FactCheckJudgmentError("FACT_CHECK_CONTRADICTION_EVIDENCE_REQUIRED");
    }
    if (
      assessment.researchVerdict === "supported" &&
      !citations.some((citation) => citation.relation === "supports")
    ) {
      throw new FactCheckJudgmentError("FACT_CHECK_SUPPORTING_EVIDENCE_REQUIRED");
    }
    if (
      assessment.researchVerdict === "misleading" &&
      !citations.some((citation) => citation.relation === "qualifies" || citation.relation === "contradicts")
    ) {
      throw new FactCheckJudgmentError("FACT_CHECK_QUALIFYING_EVIDENCE_REQUIRED");
    }
  }

  return {
    evidencePackage,
    judgment: parsedJudgment.data as FactCheckJudgment,
  };
}
