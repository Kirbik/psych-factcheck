import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ReportNarrativeProvider } from "./report-narrative";
import { reportNarrativeSchema } from "./report-narrative";
import {
  FACT_CHECK_JUDGMENT_VERSION,
  validateEvidenceBoundJudgment,
  validateEvidencePackage,
} from "./judgment";
import type { FactCheckJudgment } from "./providers";

export type ReportNarrativeTarget = {
  readonly claimId: string;
  readonly evidencePackageId: string;
};

const stringList = (value: Json): readonly string[] | null => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return null;
  return value.filter((item): item is string => typeof item === "string");
};

export function createReportNarrativeService(
  client: SupabaseClient<Database>,
  provider: ReportNarrativeProvider,
) {
  return {
    async generateAndSave(input: {
      readonly targets: readonly ReportNarrativeTarget[];
      readonly jobId: string;
      readonly generation: number;
      readonly runId: string;
    }) {
      const { data: existing, error: existingError } = await client
        .from("analysis_report_narratives")
        .select("id")
        .eq("job_id", input.jobId)
        .eq("generation", input.generation)
        .eq("schema_version", provider.schemaVersion)
        .maybeSingle();
      if (existingError) throw new Error("Report narrative read failed");
      if (existing) return existing.id;

      const claimIds = input.targets.map(({ claimId }) => claimId);
      const packageIds = input.targets.map(
        ({ evidencePackageId }) => evidencePackageId,
      );
      if (
        new Set(claimIds).size !== claimIds.length ||
        new Set(packageIds).size !== packageIds.length
      )
        throw new Error("Report narrative targets are not unique");

      const [packagesResult, checksResult] = await Promise.all([
        packageIds.length
          ? client
              .from("evidence_packages")
              .select("id, claim_id, payload")
              .in("id", packageIds)
          : Promise.resolve({ data: [], error: null }),
        claimIds.length
          ? client
              .from("fact_checks")
              .select(
                "id, claim_id, evidence_package_id, verdict, confidence, explanation, limitations",
              )
              .in("claim_id", claimIds)
              .in("evidence_package_id", packageIds)
              .eq("judgment_version", FACT_CHECK_JUDGMENT_VERSION)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (
        packagesResult.error ||
        !packagesResult.data ||
        checksResult.error ||
        !checksResult.data
      )
        throw new Error("Report narrative inputs read failed");
      const packagesById = new Map(
        packagesResult.data.map((row) => [row.id, row]),
      );
      const checkByTarget = new Map(
        checksResult.data.map((row) => [
          `${row.claim_id}:${row.evidence_package_id}`,
          row,
        ]),
      );
      if (
        input.targets.some(
          ({ claimId, evidencePackageId }) =>
            !packagesById.has(evidencePackageId) ||
            !checkByTarget.has(`${claimId}:${evidencePackageId}`),
        )
      )
        throw new Error("Report narrative fact checks are incomplete");

      const checkRows = input.targets.flatMap(
        ({ claimId, evidencePackageId }) => {
          const row = checkByTarget.get(`${claimId}:${evidencePackageId}`);
          return row ? [row] : [];
        },
      );
      const { data: citations, error: citationError } = checkRows.length
        ? await client
            .from("fact_check_evidence")
            .select("fact_check_id, evidence_chunk_id, relation, rationale")
            .in(
              "fact_check_id",
              checkRows.map(({ id }) => id),
            )
        : { data: [], error: null };
      if (citationError || !citations)
        throw new Error("Report narrative citations read failed");

      const promptInputs = input.targets.map(
        ({ claimId, evidencePackageId }) => {
          const packageRow = packagesById.get(evidencePackageId);
          const check = checkByTarget.get(`${claimId}:${evidencePackageId}`);
          if (!packageRow || !check)
            throw new Error("Report narrative inputs are incomplete");
          const evidencePackage = validateEvidencePackage(packageRow.payload);
          const limitations = stringList(check.limitations);
          if (!limitations)
            throw new Error("Stored fact-check limitations are invalid");
          const judgment: FactCheckJudgment = {
            verdict: check.verdict as FactCheckJudgment["verdict"],
            confidence: check.confidence,
            explanation: check.explanation,
            limitations,
            citations: citations
              .filter(({ fact_check_id }) => fact_check_id === check.id)
              .map(({ evidence_chunk_id, relation, rationale }) => ({
                chunkId: evidence_chunk_id,
                relation:
                  relation as FactCheckJudgment["citations"][number]["relation"],
                rationale,
              })),
          };
          validateEvidenceBoundJudgment(evidencePackage, judgment);
          return { claimId, evidencePackage, judgment };
        },
      );
      const narrative = reportNarrativeSchema.parse(
        await provider.generate(promptInputs),
      );
      const commentaryByClaim = new Map(
        narrative.claims.map(({ claimId: id, commentary }) => [id, commentary]),
      );
      const payload = {
        claims: input.targets.map((target) => {
          const check = checkByTarget.get(
            `${target.claimId}:${target.evidencePackageId}`,
          );
          const commentary = commentaryByClaim.get(target.claimId);
          if (!check || !commentary)
            throw new Error("Report narrative claim is missing");
          return { claimId: target.claimId, factCheckId: check.id, commentary };
        }),
        overallConclusion: narrative.overallConclusion,
        subjectiveOpinion: narrative.subjectiveOpinion,
        historicalReferences: narrative.historicalReferences ?? [],
      };
      const { data, error } = await client.rpc(
        "save_analysis_report_narrative_for_run",
        {
          p_job_id: input.jobId,
          p_generation: input.generation,
          p_run_id: input.runId,
          p_provider: provider.provider,
          p_model: provider.model,
          p_narrative_version: provider.narrativeVersion,
          p_prompt_version: provider.promptVersion,
          p_schema_version: provider.schemaVersion,
          p_payload: payload as unknown as Json,
        },
      );
      if (error || !data) throw new Error("Report narrative write failed");
      return data;
    },
  };
}
