import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  PIPELINE_VERSION,
  SCREENED_OUT_ERROR_CODE,
  TRANSCRIPTION_VERSION,
} from "@/features/analysis/job-contract";
import {
  evidenceItemSchema,
  SUPPORTED_FACT_CHECK_JUDGMENT_VERSIONS,
} from "@/server/ai/judgment";
import {
  ReportLocalizationError,
  translateReportTextToRussian,
} from "@/server/ai/report-localization";
import { CLAIM_EXTRACTION_VERSION } from "@/server/ai/claim-extraction";
import { SUPPORTED_EVIDENCE_RERANKING_VERSIONS } from "@/server/evidence/reranking";
import { SUPPORTED_EVIDENCE_RETRIEVAL_VERSIONS } from "@/server/evidence/search";
import {
  REPORT_NARRATIVE_SCHEMA_VERSION,
  persistedReportNarrativeSchema,
} from "@/server/ai/report-narrative";
import { verdicts, type Verdict } from "@/types/fact-check";
import type {
  ReportClaim,
  ReportClaimStatus,
  ReportLoadResult,
  ReportSource,
} from "@/features/report/report-contract";
import { z } from "zod";

type ReportClient = SupabaseClient<Database>;

const verdictSchema = z.enum(verdicts);
const confidenceSchema = z.number().finite().min(0).max(1);

function toReportStatus(
  verdict: Verdict,
  hasResolvedCitations: boolean,
): ReportClaimStatus {
  switch (verdict) {
    case "CONTRADICTED":
      return "contradicted";
    case "SUPPORTED":
      return "supported";
    case "MOSTLY_SUPPORTED":
    case "OVERSIMPLIFIED":
      return "disputed";
    case "INSUFFICIENT_EVIDENCE":
      // Evidence was considered but did not settle the claim. Bibliographic
      // metadata, uncited candidates and subjective opinions do not qualify.
      return hasResolvedCitations ? "disputed" : "not-found";
    case "UNVERIFIABLE":
      return "not-found";
  }
}

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function reportRepository(client: ReportClient) {
  return {
    async getOwnedReport(
      contentItemId: string,
      userId: string,
    ): Promise<ReportLoadResult> {
      const { data: content, error: contentError } = await client
        .from("content_items")
        .select("id, original_file_name")
        .eq("id", contentItemId)
        .eq("user_id", userId)
        .maybeSingle();
      if (contentError || !content) return { kind: "not_found" };

      const fileName = content.original_file_name ?? "Проверка видео";
      const common = { contentItemId, fileName };
      const { data: job, error: jobError } = await client
        .from("analysis_jobs")
        .select("id, generation, status, stage, completed_at, error_code")
        .eq("content_item_id", contentItemId)
        .eq("user_id", userId)
        .eq("pipeline_version", PIPELINE_VERSION)
        .maybeSingle();
      if (jobError) return { kind: "unavailable", ...common };
      if (!job || job.status === "queued" || job.status === "running")
        return { kind: "processing", ...common };
      if (
        job.status === "completed" &&
        job.error_code === SCREENED_OUT_ERROR_CODE
      )
        return { kind: "out_of_scope", ...common };
      if (
        job.status !== "completed" ||
        job.stage !== "complete" ||
        job.error_code ||
        !job.completed_at
      )
        return { kind: "failed", ...common };

      const { data: narrativeRow, error: narrativeError } = await client
        .from("analysis_report_narratives")
        .select("payload")
        .eq("job_id", job.id)
        .eq("generation", job.generation)
        .eq("schema_version", REPORT_NARRATIVE_SCHEMA_VERSION)
        .maybeSingle();
      if (narrativeError) return { kind: "unavailable", ...common };
      const narrativeParsed = narrativeRow
        ? persistedReportNarrativeSchema.safeParse(narrativeRow.payload)
        : null;
      if (narrativeParsed && !narrativeParsed.success)
        return { kind: "unavailable", ...common };
      const narrative = narrativeParsed?.success
        ? {
            overallConclusion: narrativeParsed.data.overallConclusion,
            subjectiveOpinion: narrativeParsed.data.subjectiveOpinion,
          }
        : null;
      const modelCommentaryByClaim = new Map<string, string>();

      const { data: transcript, error: transcriptError } = await client
        .from("transcripts")
        .select("id")
        .eq("content_item_id", contentItemId)
        .eq("pipeline_version", TRANSCRIPTION_VERSION)
        .maybeSingle();
      if (transcriptError || !transcript)
        return { kind: "unavailable", ...common };

      const { data: extraction, error: extractionError } = await client
        .from("claim_extractions")
        .select("id")
        .eq("transcript_id", transcript.id)
        .eq("extraction_version", CLAIM_EXTRACTION_VERSION)
        .maybeSingle();
      if (extractionError || !extraction)
        return { kind: "unavailable", ...common };

      const { data: claims, error: claimsError } = await client
        .from("claims")
        .select(
          "id, original_text, normalized_text, start_seconds, end_seconds, ordinal",
        )
        .eq("claim_extraction_id", extraction.id)
        .order("ordinal", { ascending: true });
      if (claimsError || !claims) return { kind: "unavailable", ...common };
      if (claims.length === 0) {
        if (
          narrativeParsed?.success &&
          narrativeParsed.data.claims.length !== 0
        )
          return { kind: "unavailable", ...common };
        return {
          kind: "ready",
          report: {
            ...common,
            checkedAt: job.completed_at,
            narrative,
            claims: [],
          },
        };
      }

      const claimIds = claims.map(({ id }) => id);
      const { data: packages, error: packagesError } = await client
        .from("evidence_packages")
        .select("id, claim_id")
        .in("claim_id", claimIds)
        .in("retrieval_version", [...SUPPORTED_EVIDENCE_RETRIEVAL_VERSIONS])
        .in("reranking_version", [...SUPPORTED_EVIDENCE_RERANKING_VERSIONS]);
      if (packagesError || !packages) return { kind: "unavailable", ...common };
      const packageByClaim = new Map(
        packages.map((item) => [item.claim_id, item]),
      );
      if (claims.some(({ id }) => !packageByClaim.has(id)))
        return { kind: "unavailable", ...common };

      const packageIds = packages.map(({ id }) => id);
      const { data: factChecks, error: factChecksError } = await client
        .from("fact_checks")
        .select(
          "id, claim_id, evidence_package_id, judgment_version, verdict, confidence, explanation",
        )
        .in("claim_id", claimIds)
        .in("evidence_package_id", packageIds)
        .in("judgment_version", [...SUPPORTED_FACT_CHECK_JUDGMENT_VERSIONS])
        .order("created_at", { ascending: false });
      if (factChecksError || !factChecks)
        return { kind: "unavailable", ...common };
      const checkByClaim = new Map<string, (typeof factChecks)[number]>();
      const narrativeCheckIds = new Map(
        narrativeParsed?.success
          ? narrativeParsed.data.claims.map((item) => [
              item.claimId,
              item.factCheckId,
            ])
          : [],
      );
      for (const item of factChecks) {
        const expectedId = narrativeCheckIds.get(item.claim_id);
        if (expectedId && item.id !== expectedId) continue;
        if (
          !packages.some(
            (pkg) =>
              pkg.id === item.evidence_package_id &&
              pkg.claim_id === item.claim_id,
          )
        )
          return { kind: "unavailable", ...common };
        const previous = checkByClaim.get(item.claim_id);
        const rank = (version: string) =>
          SUPPORTED_FACT_CHECK_JUDGMENT_VERSIONS.findIndex(
            (v) => v === version,
          );
        if (
          !previous ||
          rank(item.judgment_version) < rank(previous.judgment_version)
        ) {
          checkByClaim.set(item.claim_id, item);
        }
      }
      if (claims.some(({ id }) => !checkByClaim.has(id)))
        return { kind: "unavailable", ...common };

      if (narrativeParsed?.success) {
        if (narrativeParsed.data.claims.length !== claims.length)
          return { kind: "unavailable", ...common };
        for (const item of narrativeParsed.data.claims) {
          const check = checkByClaim.get(item.claimId);
          if (
            !check ||
            check.id !== item.factCheckId ||
            modelCommentaryByClaim.has(item.claimId)
          )
            return { kind: "unavailable", ...common };
          modelCommentaryByClaim.set(item.claimId, item.commentary);
        }
      }

      const checkIds = [...checkByClaim.values()].map(({ id }) => id);
      const { data: citations, error: citationsError } = await client
        .from("fact_check_evidence")
        .select("fact_check_id, evidence_chunk_id, ordinal")
        .in("fact_check_id", checkIds)
        .order("ordinal", { ascending: true });
      if (citationsError || !citations)
        return { kind: "unavailable", ...common };

      const { data: packageItems, error: itemsError } = await client
        .from("evidence_package_items")
        .select("evidence_package_id, evidence_chunk_id, snapshot")
        .in("evidence_package_id", packageIds);
      if (itemsError || !packageItems)
        return { kind: "unavailable", ...common };
      const snapshotById = new Map<
        string,
        ReturnType<typeof evidenceItemSchema.parse>
      >();
      for (const item of packageItems) {
        const parsed = evidenceItemSchema.safeParse(item.snapshot);
        if (!parsed.success || parsed.data.chunkId !== item.evidence_chunk_id)
          return { kind: "unavailable", ...common };
        snapshotById.set(
          item.evidence_package_id + ":" + item.evidence_chunk_id,
          parsed.data,
        );
      }
      const { data: localizations, error: localizationError } = await client
        .from("report_localizations")
        .select("fact_check_id, normalized_text, explanation")
        .in("fact_check_id", checkIds)
        .eq("locale", "ru");
      if (localizationError || !localizations)
        return { kind: "localization_unavailable", ...common };
      const localizedByCheck = new Map(
        localizations.map((item) => [item.fact_check_id, item]),
      );
      const claimsByCheckId = new Map<string, (typeof claims)[number]>();
      for (const claim of claims) {
        const check = checkByClaim.get(claim.id);
        if (check) claimsByCheckId.set(check.id, claim);
      }
      const untranslated = factChecks.flatMap((check) => {
        if (localizedByCheck.has(check.id)) return [];
        const claim = claimsByCheckId.get(check.id);
        if (!claim) return [];
        const isPredominantlyRussian = (value: string) => {
          const cyrillicLetters = value.match(/[А-Яа-яЁё]/gu)?.length ?? 0;
          const latinLetters = value.match(/[A-Za-z]/gu)?.length ?? 0;
          return cyrillicLetters > latinLetters;
        };
        if (
          isPredominantlyRussian(claim.normalized_text) &&
          isPredominantlyRussian(check.explanation)
        ) {
          localizedByCheck.set(check.id, {
            fact_check_id: check.id,
            normalized_text: claim.normalized_text,
            explanation: check.explanation,
          });
          return [];
        }
        return [
          {
            factCheckId: check.id,
            normalizedText: claim.normalized_text,
            explanation: check.explanation,
          },
        ];
      });
      if (untranslated.length > 0) {
        try {
          const translations = await translateReportTextToRussian(
            process.env.OPENAI_API_KEY,
            untranslated,
          );
          const claimIdByCheckId = new Map(
            untranslated.flatMap((item) => {
              const claim = claimsByCheckId.get(item.factCheckId);
              return claim ? [[item.factCheckId, claim.id] as const] : [];
            }),
          );
          const { error: saveLocalizationError } = await client.rpc(
            "save_report_localizations_ru",
            {
              p_translations: translations.map((translation) => ({
                fact_check_id: translation.fact_check_id,
                claim_id: claimIdByCheckId.get(translation.fact_check_id),
                normalized_text: translation.normalized_text,
                explanation: translation.explanation,
              })),
              p_model: "gpt-4o-mini",
              p_prompt_version: "report-localization-ru-v1",
            },
          );
          if (saveLocalizationError)
            return { kind: "localization_unavailable", ...common };
          for (const translation of translations) {
            localizedByCheck.set(translation.fact_check_id, {
              fact_check_id: translation.fact_check_id,
              normalized_text: translation.normalized_text,
              explanation: translation.explanation,
            });
          }
        } catch (error) {
          if (error instanceof ReportLocalizationError)
            return { kind: "localization_unavailable", ...common };
          return { kind: "localization_unavailable", ...common };
        }
      }

      const checkById = new Map(factChecks.map((check) => [check.id, check]));
      const citationsByCheck = new Map<string, Map<string, ReportSource>>();
      for (const citation of citations) {
        const check = checkById.get(citation.fact_check_id);
        const item = check
          ? snapshotById.get(
              check.evidence_package_id + ":" + citation.evidence_chunk_id,
            )
          : null;
        if (!item) return { kind: "unavailable", ...common };
        const source = item.source;
        const cited =
          citationsByCheck.get(citation.fact_check_id) ??
          new Map<string, ReportSource>();
        cited.set(item.sourceId, {
          id: item.sourceId,
          title: source.title,
          authors: source.authors,
          journal: source.journal,
          publisher: source.publisher ?? "",
          publishedAt: source.publishedAt,
          sourceType: source.type,
          url: safeWebUrl(source.canonicalUrl),
        });
        citationsByCheck.set(citation.fact_check_id, cited);
      }
      const reportClaims: ReportClaim[] = [];
      for (const claim of claims) {
        const check = checkByClaim.get(claim.id);
        if (!check) return { kind: "unavailable", ...common };
        const verdict = verdictSchema.safeParse(check.verdict);
        const confidence = confidenceSchema.safeParse(check.confidence);
        if (
          !verdict.success ||
          !confidence.success ||
          !check.explanation.trim()
        )
          return { kind: "unavailable", ...common };
        const citedSourceIds =
          citationsByCheck.get(check.id) ?? new Map<string, ReportSource>();
        const localized = localizedByCheck.get(check.id);
        if (!localized) return { kind: "localization_unavailable", ...common };
        reportClaims.push({
          id: claim.id,
          title: localized.normalized_text,
          originalText: claim.original_text,
          normalizedText: localized.normalized_text,
          startSeconds: claim.start_seconds,
          endSeconds: claim.end_seconds,
          verdict: verdict.data,
          status: toReportStatus(verdict.data, citedSourceIds.size > 0),
          confidence: confidence.data,
          explanation: localized.explanation,
          modelCommentary: modelCommentaryByClaim.get(claim.id) ?? null,
          sources: [...citedSourceIds.values()],
        });
      }

      return {
        kind: "ready",
        report: {
          ...common,
          checkedAt: job.completed_at,
          narrative,
          claims: reportClaims,
        },
      };
    },
  };
}
