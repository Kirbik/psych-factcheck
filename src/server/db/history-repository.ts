import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  PIPELINE_VERSION,
  SCREENED_OUT_ERROR_CODE,
  TRANSCRIPTION_VERSION,
} from "@/features/analysis/job-contract";
import type {
  HistoryCheck,
  HistoryLoadResult,
} from "@/features/history/history-contract";
import { CLAIM_EXTRACTION_VERSION } from "@/server/ai/claim-extraction";
import { FACT_CHECK_JUDGMENT_VERSION } from "@/server/ai/judgment";

type HistoryClient = SupabaseClient<Database>;

function formatCheckDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function historyRepository(client: HistoryClient) {
  return {
    async listOwnedChecks(userId: string): Promise<HistoryLoadResult> {
      const { data: contentItems, error: contentError } = await client
        .from("content_items")
        .select("id, original_file_name, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (contentError || !contentItems) return { kind: "unavailable" };
      if (contentItems.length === 0) return { kind: "ready", checks: [] };

      const contentIds = contentItems.map(({ id }) => id);
      const { data: jobs, error: jobsError } = await client
        .from("analysis_jobs")
        .select("content_item_id, status, stage, completed_at, error_code")
        .eq("user_id", userId)
        .eq("pipeline_version", PIPELINE_VERSION)
        .in("content_item_id", contentIds);
      if (jobsError || !jobs) return { kind: "unavailable" };

      const { data: transcripts, error: transcriptsError } = await client
        .from("transcripts")
        .select("id, content_item_id")
        .in("content_item_id", contentIds)
        .eq("pipeline_version", TRANSCRIPTION_VERSION);
      if (transcriptsError || !transcripts) return { kind: "unavailable" };

      const transcriptIds = transcripts.map(({ id }) => id);
      const { data: extractions, error: extractionsError } =
        transcriptIds.length
          ? await client
              .from("claim_extractions")
              .select("id, transcript_id")
              .in("transcript_id", transcriptIds)
              .eq("extraction_version", CLAIM_EXTRACTION_VERSION)
          : { data: [], error: null };
      if (extractionsError || !extractions) return { kind: "unavailable" };

      const extractionIds = extractions.map(({ id }) => id);
      const { data: claims, error: claimsError } = extractionIds.length
        ? await client
            .from("claims")
            .select("id, claim_extraction_id")
            .in("claim_extraction_id", extractionIds)
        : { data: [], error: null };
      if (claimsError || !claims) return { kind: "unavailable" };

      const claimIds = claims.map(({ id }) => id);
      const { data: factChecks, error: factChecksError } = claimIds.length
        ? await client
            .from("fact_checks")
            .select("claim_id")
            .in("claim_id", claimIds)
            .eq("judgment_version", FACT_CHECK_JUDGMENT_VERSION)
        : { data: [], error: null };
      if (factChecksError || !factChecks) return { kind: "unavailable" };

      const transcriptById = new Map(
        transcripts.map(({ id, content_item_id }) => [id, content_item_id]),
      );
      const extractionById = new Map(
        extractions.map(({ id, transcript_id }) => [id, transcript_id]),
      );
      const claimCounts = new Map<string, { total: number; checked: number }>();
      for (const claim of claims) {
        const transcriptId = extractionById.get(claim.claim_extraction_id);
        const contentItemId = transcriptId
          ? transcriptById.get(transcriptId)
          : undefined;
        if (!contentItemId) continue;
        const counts = claimCounts.get(contentItemId) ?? {
          total: 0,
          checked: 0,
        };
        counts.total += 1;
        claimCounts.set(contentItemId, counts);
      }

      const checkedClaimIds = new Set(
        factChecks.map(({ claim_id }) => claim_id),
      );
      const claimContentItemById = new Map<string, string>();
      for (const claim of claims) {
        const transcriptId = extractionById.get(claim.claim_extraction_id);
        const contentItemId = transcriptId
          ? transcriptById.get(transcriptId)
          : undefined;
        if (contentItemId) claimContentItemById.set(claim.id, contentItemId);
      }
      for (const claimId of checkedClaimIds) {
        const contentItemId = claimContentItemById.get(claimId);
        const counts = contentItemId
          ? claimCounts.get(contentItemId)
          : undefined;
        if (counts) counts.checked += 1;
      }

      const jobByContentId = new Map(
        jobs.map((job) => [job.content_item_id, job]),
      );
      const checks: HistoryCheck[] = contentItems.map((item) => {
        const job = jobByContentId.get(item.id);
        const screenedOut =
          job?.status === "completed" &&
          job.error_code === SCREENED_OUT_ERROR_CODE;
        const status: HistoryCheck["status"] =
          item.status === "failed" ||
          job?.status === "failed" ||
          job?.status === "cancelled" ||
          (job?.status === "completed" &&
            !screenedOut &&
            (job.stage !== "complete" || job.error_code !== null))
            ? "failed"
            : job?.status === "completed"
              ? "completed"
              : "processing";
        const counts = claimCounts.get(item.id) ?? { total: 0, checked: 0 };
        const dateValue =
          status === "completed" && job?.completed_at
            ? job.completed_at
            : item.created_at;

        return {
          id: item.id,
          title: item.original_file_name ?? "Проверка видео",
          status,
          claims: `${counts.checked} из ${counts.total}`,
          date: formatCheckDate(dateValue),
          action:
            status === "completed"
              ? "Открыть отчёт"
              : status === "failed"
                ? "Посмотреть детали"
                : "Открыть статус",
          href:
            status === "completed"
              ? `/report?contentItemId=${encodeURIComponent(item.id)}`
              : `/processing?contentItemId=${encodeURIComponent(item.id)}`,
        };
      });

      return { kind: "ready", checks };
    },
  };
}
