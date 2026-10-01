import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  validateEvidenceBoundJudgment,
  validateEvidencePackage,
} from "./judgment";
import type { EvidencePackage, FactCheckJudgment } from "./providers";

export interface FactCheckMetadata {
  readonly claimId: string;
  readonly evidencePackageId: string;
  readonly judgmentVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly instructionsVersion: string;
  readonly schemaVersion: string;
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

export function factCheckRepository(client: SupabaseClient<Database>) {
  async function getEvidencePackage(
    claimId: string,
    evidencePackageId: string,
  ): Promise<EvidencePackage> {
    const { data: packageRow, error: readError } = await client
      .from("evidence_packages")
      .select("claim_id, payload")
      .eq("id", evidencePackageId)
      .eq("claim_id", claimId)
      .maybeSingle();
    if (readError || !packageRow)
      throw new Error("Evidence package read failed");
    return validateEvidencePackage(packageRow.payload);
  }

  return {
    getEvidencePackage,
    async save(
      metadata: FactCheckMetadata,
      evidencePackageInput: EvidencePackage,
      judgmentInput: FactCheckJudgment,
    ): Promise<string> {
      const persistedPackage = await getEvidencePackage(
        metadata.claimId,
        metadata.evidencePackageId,
      );
      const suppliedPackage = validateEvidencePackage(evidencePackageInput);
      if (
        JSON.stringify(canonicalizeJson(persistedPackage)) !==
        JSON.stringify(canonicalizeJson(suppliedPackage))
      ) {
        throw new Error("Judgment evidence package mismatch");
      }
      const { judgment } = validateEvidenceBoundJudgment(
        persistedPackage,
        judgmentInput,
      );
      const { data, error } = await client.rpc("save_fact_check", {
        p_claim_id: metadata.claimId,
        p_evidence_package_id: metadata.evidencePackageId,
        p_judgment_version: metadata.judgmentVersion,
        p_provider: metadata.provider,
        p_model: metadata.model,
        p_instructions_version: metadata.instructionsVersion,
        p_schema_version: metadata.schemaVersion,
        p_judgment: {
          verdict: judgment.verdict,
          confidence: judgment.confidence,
          explanation: judgment.explanation,
          limitations: judgment.limitations,
          citations: judgment.citations.map((citation) => ({
            chunkId: citation.chunkId,
            relation: citation.relation,
            rationale: citation.rationale,
          })),
        } as unknown as Json,
      });
      if (error || !data) throw new Error("Fact-check write failed");
      return data;
    },
  };
}
