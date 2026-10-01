import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  PIPELINE_VERSION,
  SCREENED_OUT_ERROR_CODE,
  TRANSCRIPTION_VERSION,
} from "@/features/analysis/job-contract";
import { FACT_CHECK_JUDGMENT_VERSION } from "@/server/ai/judgment";
import { CLAIM_EXTRACTION_VERSION } from "@/server/ai/claim-extraction";
import { EVIDENCE_RERANKING_VERSION } from "@/server/evidence/reranking";
import { EVIDENCE_RETRIEVAL_VERSION } from "@/server/evidence/search";
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

function toReportStatus(verdict: Verdict): ReportClaimStatus {
  switch (verdict) {
    case "CONTRADICTED":
      return "contradicted";
    case "SUPPORTED":
      return "supported";
    case "MOSTLY_SUPPORTED":
    case "OVERSIMPLIFIED":
      return "disputed";
    case "INSUFFICIENT_EVIDENCE":
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
        .select("status, stage, completed_at, error_code")
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
        return {
          kind: "ready",
          report: { ...common, checkedAt: job.completed_at, claims: [] },
        };
      }

      const claimIds = claims.map(({ id }) => id);
      const { data: packages, error: packagesError } = await client
        .from("evidence_packages")
        .select("id, claim_id")
        .in("claim_id", claimIds)
        .eq("retrieval_version", EVIDENCE_RETRIEVAL_VERSION)
        .eq("reranking_version", EVIDENCE_RERANKING_VERSION);
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
          "id, claim_id, evidence_package_id, verdict, confidence, explanation",
        )
        .in("claim_id", claimIds)
        .in("evidence_package_id", packageIds)
        .eq("judgment_version", FACT_CHECK_JUDGMENT_VERSION);
      if (factChecksError || !factChecks)
        return { kind: "unavailable", ...common };
      const checkByClaim = new Map(
        factChecks.map((item) => [item.claim_id, item]),
      );
      if (claims.some(({ id }) => !checkByClaim.has(id)))
        return { kind: "unavailable", ...common };

      const checkIds = factChecks.map(({ id }) => id);
      const { data: citations, error: citationsError } = await client
        .from("fact_check_evidence")
        .select("fact_check_id, evidence_chunk_id, ordinal")
        .in("fact_check_id", checkIds)
        .order("ordinal", { ascending: true });
      if (citationsError || !citations)
        return { kind: "unavailable", ...common };

      const chunkIds = [
        ...new Set(citations.map(({ evidence_chunk_id }) => evidence_chunk_id)),
      ];
      const { data: chunks, error: chunksError } = chunkIds.length
        ? await client
            .from("evidence_chunks")
            .select("id, source_id")
            .in("id", chunkIds)
        : { data: [], error: null };
      if (chunksError || !chunks) return { kind: "unavailable", ...common };
      const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
      if (
        citations.some(
          ({ evidence_chunk_id }) => !chunkById.has(evidence_chunk_id),
        )
      )
        return { kind: "unavailable", ...common };

      const sourceIds = [...new Set(chunks.map(({ source_id }) => source_id))];
      const { data: sources, error: sourcesError } = sourceIds.length
        ? await client
            .from("sources")
            .select(
              "id, title, authors, journal, publisher, published_at, source_type, canonical_url",
            )
            .in("id", sourceIds)
        : { data: [], error: null };
      if (sourcesError || !sources) return { kind: "unavailable", ...common };
      const sourceById = new Map(
        sources.map((source) => [
          source.id,
          {
            id: source.id,
            title: source.title,
            authors: source.authors,
            journal: source.journal,
            publisher: source.publisher,
            publishedAt: source.published_at,
            sourceType: source.source_type,
            url: safeWebUrl(source.canonical_url),
          } satisfies ReportSource,
        ]),
      );
      if (chunks.some(({ source_id }) => !sourceById.has(source_id)))
        return { kind: "unavailable", ...common };

      const citationsByCheck = new Map<string, Set<string>>();
      for (const citation of citations) {
        const chunk = chunkById.get(citation.evidence_chunk_id);
        const source = chunk ? sourceById.get(chunk.source_id) : null;
        if (!chunk || !source) return { kind: "unavailable", ...common };
        const sourceIdsForCheck =
          citationsByCheck.get(citation.fact_check_id) ?? new Set<string>();
        sourceIdsForCheck.add(source.id);
        citationsByCheck.set(citation.fact_check_id, sourceIdsForCheck);
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
          citationsByCheck.get(check.id) ?? new Set<string>();
        reportClaims.push({
          id: claim.id,
          title: claim.normalized_text,
          originalText: claim.original_text,
          normalizedText: claim.normalized_text,
          startSeconds: claim.start_seconds,
          endSeconds: claim.end_seconds,
          verdict: verdict.data,
          status: toReportStatus(verdict.data),
          confidence: confidence.data,
          explanation: check.explanation,
          sources: [...citedSourceIds].flatMap((id) => {
            const source = sourceById.get(id);
            return source ? [source] : [];
          }),
        });
      }

      return {
        kind: "ready",
        report: {
          ...common,
          checkedAt: job.completed_at,
          claims: reportClaims,
        },
      };
    },
  };
}
