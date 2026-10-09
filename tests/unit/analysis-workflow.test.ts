import { describe, expect, it, vi } from "vitest";
import {
  isActiveJob,
  jobPayloadSchema,
  jobResponseSchema,
  PIPELINE_VERSION,
} from "@/features/analysis/job-contract";
import {
  dispatchJob,
  reconcileJob,
  type WorkflowRunner,
} from "@/server/workflows/dispatch";
import {
  executeClaimExtractionStage,
  executeEvidencePackageStage,
  executeJudgmentStage,
  executeWorkflow,
  PermanentWorkflowError,
} from "@/server/workflows/execute";
import type {
  AnalysisJob,
  WorkflowRepository,
} from "@/server/workflows/repository";
import { workflowDatabaseFailure } from "@/server/workflows/repository";
import type { ClaimExtractionProvider } from "@/server/ai/providers";
import {
  CLAIM_EXTRACTION_MODEL,
  CLAIM_EXTRACTION_SCHEMA_VERSION,
  CLAIM_EXTRACTION_VERSION,
} from "@/server/ai/claim-extraction";
import { CLAIM_EXTRACTION_INSTRUCTIONS_VERSION } from "@/server/ai/prompts/claim-extraction-v2";
import {
  SCREENING_CLASSIFIER_MODEL,
  SCREENING_INSTRUCTIONS_VERSION,
  SCREENING_SAMPLE_MODEL,
  type VideoScreening,
} from "@/server/ai/video-screening";
import { MAX_VIDEO_SIZE_BYTES } from "@/server/storage/video-validator";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));

const userId = "11111111-1111-4111-8111-111111111111";
const contentId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const uploadId = "44444444-4444-4444-8444-444444444444";

describe("workflow database errors", () => {
  it("includes only a sanitized Supabase error code", () => {
    expect(workflowDatabaseFailure("Fact-check read", "PGRST116").message).toBe(
      "Fact-check read failed (Supabase error code PGRST116)",
    );
    expect(
      workflowDatabaseFailure("Job read", "secret query details").message,
    ).toBe("Job read failed (Supabase error code unavailable)");
  });
});
const payload = { jobId, generation: 1 };
const runId = "run_workflow_1";
const extractionId = "66666666-6666-4666-8666-666666666666";
const claimId = "77777777-7777-4777-8777-777777777777";
const evidencePackageId = "88888888-8888-4888-8888-888888888888";
const timestamp = "2026-09-27T00:00:00.000Z";
type ScreenVideo = NonNullable<Parameters<typeof executeWorkflow>[6]>;

function validVideo(size = 1024) {
  return {
    size,
    header: new Uint8Array([
      0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109,
    ]),
  };
}

function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: jobId,
    user_id: userId,
    content_item_id: contentId,
    pipeline_version: PIPELINE_VERSION,
    generation: 1,
    status: "queued",
    stage: "queued",
    run_id: null,
    attempt: 0,
    error_code: null,
    started_at: null,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

type Content = Database["public"]["Tables"]["content_items"]["Row"];

function content(overrides: Partial<Content> = {}): Content {
  return {
    id: contentId,
    user_id: userId,
    type: "video",
    status: "pending",
    storage_path: `${userId}/${uploadId}.mp4`,
    original_file_name: "lesson.mp4",
    file_size_bytes: 1024,
    file_mime_type: "video/mp4",
    upload_id: uploadId,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function repository() {
  return {
    findOwned: vi.fn<WorkflowRepository["findOwned"]>(),
    request: vi.fn<WorkflowRepository["request"]>(),
    get: vi
      .fn<WorkflowRepository["get"]>()
      .mockResolvedValue(job({ run_id: runId })),
    advance: vi
      .fn<WorkflowRepository["advance"]>()
      .mockResolvedValue(job({ run_id: runId })),
    content: vi
      .fn<WorkflowRepository["content"]>()
      .mockResolvedValue(content()),
    setStage: vi.fn<WorkflowRepository["setStage"]>().mockResolvedValue(true),
    hasTranscript: vi
      .fn<WorkflowRepository["hasTranscript"]>()
      .mockResolvedValue(false),
    saveTranscript: vi
      .fn<WorkflowRepository["saveTranscript"]>()
      .mockResolvedValue(undefined),
    getTranscript: vi
      .fn<WorkflowRepository["getTranscript"]>()
      .mockResolvedValue({
        id: "55555555-5555-4555-8555-555555555555",
        result: {
          language: "ru",
          segments: [
            { startSeconds: 0, endSeconds: 1, text: "Тестовый сегмент." },
          ],
        },
      }),
    hasClaimExtraction: vi
      .fn<WorkflowRepository["hasClaimExtraction"]>()
      .mockResolvedValue(false),
    saveClaimExtraction: vi
      .fn<WorkflowRepository["saveClaimExtraction"]>()
      .mockResolvedValue(undefined),
    getClaimExtractionId: vi
      .fn<WorkflowRepository["getClaimExtractionId"]>()
      .mockResolvedValue(extractionId),
    listClaims: vi.fn<WorkflowRepository["listClaims"]>().mockResolvedValue([]),
    existingEvidencePackageClaimIds: vi
      .fn<WorkflowRepository["existingEvidencePackageClaimIds"]>()
      .mockResolvedValue(new Set()),
    saveEvidencePackages: vi
      .fn<WorkflowRepository["saveEvidencePackages"]>()
      .mockResolvedValue(undefined),
    listEvidencePackages: vi
      .fn<WorkflowRepository["listEvidencePackages"]>()
      .mockResolvedValue([]),
    existingFactCheckPairs: vi
      .fn<WorkflowRepository["existingFactCheckPairs"]>()
      .mockResolvedValue([]),
    getScreening: vi
      .fn<WorkflowRepository["getScreening"]>()
      .mockResolvedValue(null),
    saveScreening: vi
      .fn<WorkflowRepository["saveScreening"]>()
      .mockImplementation(async (_contentItemId, result) => result),
    active: vi.fn<WorkflowRepository["active"]>(),
  } satisfies WorkflowRepository;
}

function markWorkflowJobRunning(repo: ReturnType<typeof repository>) {
  repo.get.mockResolvedValue(
    job({ status: "running", stage: "build_evidence", run_id: runId }),
  );
}

function transcriber() {
  return vi.fn<Parameters<typeof executeWorkflow>[5]>().mockResolvedValue({
    language: "ru",
    segments: [{ startSeconds: 0, endSeconds: 1, text: "Тестовый сегмент." }],
  });
}

function claimExtractionProvider() {
  return {
    extractClaims: vi
      .fn<ClaimExtractionProvider["extractClaims"]>()
      .mockResolvedValue({
        extractionVersion: CLAIM_EXTRACTION_VERSION,
        provider: "openai",
        model: CLAIM_EXTRACTION_MODEL,
        instructionsVersion: CLAIM_EXTRACTION_INSTRUCTIONS_VERSION,
        schemaVersion: CLAIM_EXTRACTION_SCHEMA_VERSION,
        claims: [
          {
            original: "Недосып ухудшает память.",
            normalized: "Недосып ухудшает память.",
            startSeconds: 0,
            endSeconds: 1,
            claimType: "causal_mechanistic",
          },
        ],
      }),
  } satisfies ClaimExtractionProvider;
}

function screening(overrides: Partial<VideoScreening> = {}): VideoScreening {
  return {
    decision: "relevant",
    reasonCode: "target_topics_present",
    confidence: 0.95,
    rationale: "Сэмплы содержат содержательное обсуждение психологии.",
    sampleDurationSeconds: 12,
    provider: "openai",
    sampleModel: SCREENING_SAMPLE_MODEL,
    classifierModel: SCREENING_CLASSIFIER_MODEL,
    instructionsVersion: SCREENING_INSTRUCTIONS_VERSION,
    ...overrides,
  };
}

function runner() {
  return {
    start: vi.fn<WorkflowRunner["start"]>().mockResolvedValue(runId),
    status: vi.fn<WorkflowRunner["status"]>().mockResolvedValue("EXECUTING"),
  } satisfies WorkflowRunner;
}

describe("workflow payload and response contracts", () => {
  it.each([
    null,
    {},
    { jobId: "not-a-uuid", generation: 1 },
    { jobId, generation: 0 },
    { jobId, generation: -1 },
    { jobId, generation: 1.5 },
    { jobId, generation: "1" },
    { ...payload, userId },
    { ...payload, storagePath: "untrusted/path.mp4" },
  ])("rejects malformed or authority-bearing task payload %j", (value) => {
    expect(jobPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("accepts an explicit retry generation", () => {
    expect(jobPayloadSchema.parse({ jobId, generation: 2 })).toEqual({
      jobId,
      generation: 2,
    });
  });

  it("exposes only the public job fields when parsing a database row", () => {
    expect(jobResponseSchema.parse({ job: job() })).toEqual({
      job: {
        id: jobId,
        generation: 1,
        status: "queued",
        stage: "queued",
        attempt: 0,
        error_code: null,
      },
    });
    expect(jobResponseSchema.parse({ job: null })).toEqual({ job: null });
  });

  it("accepts a safe backend explanation for a screened-out video", () => {
    expect(
      jobResponseSchema.parse({
        job: job({ status: "completed", error_code: "VIDEO_OUT_OF_SCOPE" }),
        screening: {
          decision: "unrelated",
          reasonCode: "no_target_topic_content",
          message: "Видео не подходит для психологического фактчекинга.",
        },
      }).screening,
    ).toEqual({
      decision: "unrelated",
      reasonCode: "no_target_topic_content",
      message: "Видео не подходит для психологического фактчекинга.",
    });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "does not classify %s as active",
    (status) => {
      expect(isActiveJob({ status })).toBe(false);
    },
  );
});

describe("workflow execution", () => {
  it("persists validated claim extraction before advancing to evidence retrieval", async () => {
    const repo = repository();
    const provider = claimExtractionProvider();

    await expect(
      executeClaimExtractionStage(payload, runId, 2, repo, provider),
    ).resolves.toEqual({ outcome: "ready_for_evidence_packages" });

    expect(provider.extractClaims).toHaveBeenCalledExactlyOnceWith([
      { startSeconds: 0, endSeconds: 1, text: "Тестовый сегмент." },
    ]);
    expect(repo.saveClaimExtraction).toHaveBeenCalledExactlyOnceWith(
      "55555555-5555-4555-8555-555555555555",
      expect.objectContaining({ extractionVersion: CLAIM_EXTRACTION_VERSION }),
    );
    expect(repo.advance).toHaveBeenLastCalledWith(payload, runId, "running", 2);
  });

  it("reuses the immutable extraction marker on workflow retry", async () => {
    const repo = repository();
    repo.hasClaimExtraction.mockResolvedValue(true);
    const provider = claimExtractionProvider();

    await expect(
      executeClaimExtractionStage(payload, runId, 2, repo, provider),
    ).resolves.toEqual({ outcome: "ready_for_evidence_packages" });
    expect(provider.extractClaims).not.toHaveBeenCalled();
    expect(repo.saveClaimExtraction).not.toHaveBeenCalled();
  });

  it("retrieves and persists an idempotent evidence package before judgment", async () => {
    const repo = repository();
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Stress impairs memory.",
          normalized: "Stress impairs memory.",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "causal_mechanistic",
        },
      },
    ]);
    const retrieveEvidence = vi.fn(async () => [
      {
        retrievalVersion: "evidence-retrieval-v1",
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "openai-text-embedding-3-small-1536-v1",
        filters: {
          sourceStatus: "active" as const,
          language: null,
          sourceTypes: null,
          publishedAfter: null,
          publishedBefore: null,
          limit: 10,
        },
        candidates: [
          {
            chunkId: "88888888-8888-4888-8888-888888888888",
            sourceId: "99999999-9999-4999-8999-999999999999",
            chunkKey: "memory-result",
            content: "Stress impaired memory performance in the study.",
            language: "en",
            locator: "Abstract > Results",
            source: {
              key: "doi:10.0000/memory",
              title: "Stress and memory",
              authors: ["A. Author"],
              journal: "Example Journal",
              publishedAt: "2024-01-01",
              type: "journal_article" as const,
              canonicalUrl: "https://example.org/study",
            },
            similarity: 0.8,
          },
        ],
        warnings: [],
      },
    ]);

    await expect(
      executeEvidencePackageStage(payload, runId, 2, repo, retrieveEvidence),
    ).resolves.toEqual({ outcome: "ready_for_fact_checks" });
    expect(repo.setStage).toHaveBeenNthCalledWith(
      1,
      payload,
      runId,
      "build_evidence",
      2,
    );
    expect(repo.setStage).toHaveBeenNthCalledWith(
      2,
      payload,
      runId,
      "build_evidence",
      2,
    );
    expect(retrieveEvidence).toHaveBeenCalledExactlyOnceWith([
      "Stress impairs memory.",
    ]);
    expect(repo.saveEvidencePackages).toHaveBeenCalledWith(extractionId, [
      expect.objectContaining({
        claimId,
        package: expect.objectContaining({
          rerankingVersion: "evidence-reranking-v2",
          trace: expect.objectContaining({ candidateCount: 1 }),
        }),
      }),
    ]);
    expect(repo.advance).toHaveBeenLastCalledWith(payload, runId, "running", 2);
  });

  it("does not repeat retrieval for evidence packages already persisted on retry", async () => {
    const repo = repository();
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    repo.existingEvidencePackageClaimIds.mockResolvedValue(new Set([claimId]));
    const retrieveEvidence = vi.fn();

    await expect(
      executeEvidencePackageStage(payload, runId, 2, repo, retrieveEvidence),
    ).resolves.toEqual({ outcome: "ready_for_fact_checks" });
    expect(retrieveEvidence).not.toHaveBeenCalled();
    expect(repo.saveEvidencePackages).not.toHaveBeenCalled();
  });

  it("runs a ready claim through package persistence to saved judgment on mocks", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    const claim = {
      original: "Stress impairs memory.",
      normalized: "Stress impairs memory.",
      startSeconds: 0,
      endSeconds: 1,
      claimType: "causal_mechanistic" as const,
    };
    repo.listClaims.mockResolvedValue([{ id: claimId, claim }]);
    const candidate = {
      chunkId: "88888888-8888-4888-8888-888888888888",
      sourceId: "99999999-9999-4999-8999-999999999999",
      chunkKey: "memory-result",
      content: "Stress impaired memory performance in the reported study.",
      language: "en",
      locator: "Results",
      source: {
        key: "doi:10.0000/memory",
        title: "Stress and memory",
        authors: ["A. Author"],
        journal: "Example Journal",
        publishedAt: "2024-01-01",
        type: "journal_article" as const,
        canonicalUrl: "https://example.org/study",
      },
      similarity: 0.8,
    };
    await executeEvidencePackageStage(payload, runId, 2, repo, async () => [
      {
        retrievalVersion: "evidence-retrieval-v2",
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "embedding-v1",
        filters: {
          sourceStatus: "active",
          language: null,
          sourceTypes: null,
          publishedAfter: null,
          publishedBefore: null,
          limit: 10,
        },
        candidates: [candidate],
        warnings: [],
        references: [],
        externalSearchVersion: "external-evidence-v1",
      },
    ]);
    expect(repo.saveEvidencePackages).toHaveBeenCalledWith(extractionId, [
      expect.objectContaining({
        claimId,
        package: expect.objectContaining({ references: [] }),
      }),
    ]);

    repo.listEvidencePackages.mockResolvedValue([
      { claimId, evidencePackageId, packageClaim: claim },
    ]);
    const factChecks: string[] = [];
    const judgeAndSave = vi.fn(async () => {
      factChecks.push("saved-fact-check-id");
      return "saved-fact-check-id";
    });
    await expect(
      executeJudgmentStage(payload, runId, 3, repo, judgeAndSave),
    ).resolves.toEqual({ outcome: "fact_checks_ready" });
    expect(judgeAndSave).toHaveBeenCalledExactlyOnceWith({
      claimId,
      evidencePackageId,
    });
    expect(factChecks).toEqual(["saved-fact-check-id"]);
  });

  it("persists one judgment per current package before completing the job", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    repo.listEvidencePackages.mockResolvedValue([
      {
        claimId,
        evidencePackageId,
        packageClaim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    const judgeClaim = vi.fn().mockResolvedValue("fact-check-id");
    let preparationCalls = 0;
    const prepareJudgment = async <T>(operation: () => Promise<T>) => {
      preparationCalls += 1;
      return operation();
    };
    const createNarrative = vi.fn(async () => {
      expect(repo.advance).not.toHaveBeenCalledWith(
        payload,
        runId,
        "completed",
        3,
      );
    });

    await expect(
      executeJudgmentStage(
        payload,
        runId,
        3,
        repo,
        judgeClaim,
        prepareJudgment,
        createNarrative,
      ),
    ).resolves.toEqual({ outcome: "fact_checks_ready" });
    expect(preparationCalls).toBe(1);
    expect(repo.setStage).toHaveBeenCalledExactlyOnceWith(
      payload,
      runId,
      "judge_claims",
      3,
    );
    expect(judgeClaim).toHaveBeenCalledExactlyOnceWith({
      claimId,
      evidencePackageId,
    });
    expect(createNarrative).toHaveBeenCalledExactlyOnceWith([
      { claimId, evidencePackageId },
    ]);
    expect(repo.advance).toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      3,
    );
  });

  it("skips already persisted judgments on retry", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    repo.listEvidencePackages.mockResolvedValue([
      {
        claimId,
        evidencePackageId,
        packageClaim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    repo.existingFactCheckPairs.mockResolvedValue([
      { claimId, evidencePackageId },
    ]);
    const judgeClaim = vi.fn();

    await expect(
      executeJudgmentStage(payload, runId, 4, repo, judgeClaim),
    ).resolves.toEqual({ outcome: "fact_checks_ready" });
    expect(judgeClaim).not.toHaveBeenCalled();
    expect(repo.advance).toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      4,
    );
  });

  it("resumes a partially completed judgment run without repeating saved claims", async () => {
    const secondClaimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondEvidencePackageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "First claim",
          normalized: "First claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
      {
        id: secondClaimId,
        claim: {
          original: "Second claim",
          normalized: "Second claim",
          startSeconds: 1,
          endSeconds: 2,
          claimType: "historical",
        },
      },
    ]);
    repo.listEvidencePackages.mockResolvedValue([
      {
        claimId,
        evidencePackageId,
        packageClaim: {
          original: "First claim",
          normalized: "First claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
      {
        claimId: secondClaimId,
        evidencePackageId: secondEvidencePackageId,
        packageClaim: {
          original: "Second claim",
          normalized: "Second claim",
          startSeconds: 1,
          endSeconds: 2,
          claimType: "historical",
        },
      },
    ]);
    repo.existingFactCheckPairs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ claimId, evidencePackageId }]);
    const judgeClaim = vi
      .fn()
      .mockResolvedValueOnce("first-fact-check")
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce("second-fact-check");

    await expect(
      executeJudgmentStage(payload, runId, 2, repo, judgeClaim),
    ).rejects.toThrow("temporary provider failure");
    expect(repo.advance).not.toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      2,
    );

    await expect(
      executeJudgmentStage(payload, runId, 3, repo, judgeClaim),
    ).resolves.toEqual({ outcome: "fact_checks_ready" });
    expect(judgeClaim.mock.calls).toEqual([
      [
        {
          claimId,
          evidencePackageId,
        },
      ],
      [
        {
          claimId: secondClaimId,
          evidencePackageId: secondEvidencePackageId,
        },
      ],
      [
        {
          claimId: secondClaimId,
          evidencePackageId: secondEvidencePackageId,
        },
      ],
    ]);
    expect(repo.advance).toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      3,
    );
  });

  it("completes an extraction with no claims without making judgment calls", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    const judgeClaim = vi.fn();

    await expect(
      executeJudgmentStage(payload, runId, 2, repo, judgeClaim),
    ).resolves.toEqual({ outcome: "fact_checks_ready" });
    expect(repo.listEvidencePackages).toHaveBeenCalledExactlyOnceWith([]);
    expect(judgeClaim).not.toHaveBeenCalled();
    expect(repo.advance).toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      2,
    );
  });

  it("does not complete when a claim has no persisted Evidence Package", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Claim",
          normalized: "Claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    const judgeClaim = vi.fn();

    await expect(
      executeJudgmentStage(payload, runId, 2, repo, judgeClaim),
    ).rejects.toThrow(new PermanentWorkflowError("EVIDENCE_PACKAGE_MISSING"));
    expect(judgeClaim).not.toHaveBeenCalled();
    expect(repo.advance).not.toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      2,
    );
  });

  it("rejects an Evidence Package attached to a different extracted claim", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.listClaims.mockResolvedValue([
      {
        id: claimId,
        claim: {
          original: "Current claim",
          normalized: "Current claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    repo.listEvidencePackages.mockResolvedValue([
      {
        claimId,
        evidencePackageId,
        packageClaim: {
          original: "Different claim",
          normalized: "Different claim",
          startSeconds: 0,
          endSeconds: 1,
          claimType: "historical",
        },
      },
    ]);
    const judgeClaim = vi.fn();

    await expect(
      executeJudgmentStage(payload, runId, 2, repo, judgeClaim),
    ).rejects.toThrow(
      new PermanentWorkflowError("EVIDENCE_PACKAGE_CLAIM_MISMATCH"),
    );
    expect(judgeClaim).not.toHaveBeenCalled();
    expect(repo.advance).not.toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      2,
    );
  });

  it("stops judgment when the stage fence says the run is obsolete", async () => {
    const repo = repository();
    markWorkflowJobRunning(repo);
    repo.setStage.mockResolvedValue(false);
    const judgeClaim = vi.fn();

    await expect(
      executeJudgmentStage(payload, runId, 2, repo, judgeClaim),
    ).resolves.toEqual({ outcome: "obsolete" });
    expect(repo.listClaims).not.toHaveBeenCalled();
    expect(judgeClaim).not.toHaveBeenCalled();
    expect(repo.advance).not.toHaveBeenCalledWith(
      payload,
      runId,
      "completed",
      2,
    );
  });

  it("reports an obsolete run without reading content or Storage", async () => {
    const repo = repository();
    repo.advance.mockResolvedValue(null);
    const inspect = vi.fn<Parameters<typeof executeWorkflow>[4]>();

    await expect(
      executeWorkflow(payload, runId, 1, repo, inspect, transcriber()),
    ).resolves.toEqual({ outcome: "obsolete" });
    expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
      payload,
      runId,
      "running",
      1,
    );
    expect(repo.content).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it("passes the retry generation and attempt to both guarded writes", async () => {
    const repo = repository();
    const retryPayload = { jobId, generation: 2 };
    repo.advance.mockResolvedValue(job({ generation: 2, run_id: runId }));
    const inspect = vi
      .fn<Parameters<typeof executeWorkflow>[4]>()
      .mockResolvedValue(validVideo());
    const transcribe = transcriber();

    await expect(
      executeWorkflow(retryPayload, runId, 3, repo, inspect, transcribe),
    ).resolves.toEqual({ outcome: "ready_for_claim_extraction" });
    expect(repo.advance.mock.calls).toEqual([
      [retryPayload, runId, "running", 3],
      [retryPayload, runId, "running", 3],
    ]);
    expect(repo.setStage.mock.calls).toEqual([
      [retryPayload, runId, "screen_video", 3],
      [retryPayload, runId, "transcribe_video", 3],
    ]);
    expect(transcribe).toHaveBeenCalledExactlyOnceWith({
      storagePath: content().storage_path,
      fileName: "lesson.mp4",
      contentType: "video/mp4",
      size: 1024,
    });
    expect(repo.saveTranscript).toHaveBeenCalledExactlyOnceWith(
      contentId,
      "openai",
      "whisper-1",
      expect.objectContaining({ language: "ru" }),
    );
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledWith(content().storage_path);
    expect(repo.request).not.toHaveBeenCalled();
  });

  it("does not call OpenAI again when the immutable transcript already exists", async () => {
    const repo = repository();
    repo.hasTranscript.mockResolvedValue(true);
    const transcribe = transcriber();

    await expect(
      executeWorkflow(
        payload,
        runId,
        2,
        repo,
        async () => validVideo(),
        transcribe,
      ),
    ).resolves.toEqual({ outcome: "ready_for_claim_extraction" });
    expect(transcribe).not.toHaveBeenCalled();
    expect(repo.saveTranscript).not.toHaveBeenCalled();
  });

  it("continues to transcription for relevant, uncertain, and low-confidence screening", async () => {
    const cases = [
      screening(),
      screening({ decision: "uncertain", reasonCode: "unclear_sample" }),
      screening({
        decision: "unrelated",
        reasonCode: "incidental_mention",
        confidence: 0.89,
      }),
    ];
    for (const result of cases) {
      const repo = repository();
      const transcribe = transcriber();
      const screen = vi.fn<ScreenVideo>().mockResolvedValue(result);
      await expect(
        executeWorkflow(
          payload,
          runId,
          1,
          repo,
          async () => validVideo(),
          transcribe,
          screen,
        ),
      ).resolves.toEqual({ outcome: "ready_for_claim_extraction" });
      expect(screen).toHaveBeenCalledExactlyOnceWith({
        storagePath: content().storage_path,
        fileName: "lesson.mp4",
        contentType: "video/mp4",
        size: 1024,
      });
      expect(transcribe).toHaveBeenCalledOnce();
      expect(repo.saveScreening).toHaveBeenCalledExactlyOnceWith(
        contentId,
        result,
      );
    }
  });

  it("marks a high-confidence off-topic video complete without full transcription", async () => {
    const repo = repository();
    const transcribe = transcriber();
    const screen = vi.fn<ScreenVideo>().mockResolvedValue(
      screening({
        decision: "unrelated",
        reasonCode: "no_target_topic_content",
        confidence: 0.97,
      }),
    );

    await expect(
      executeWorkflow(
        payload,
        runId,
        1,
        repo,
        async () => validVideo(),
        transcribe,
        screen,
      ),
    ).resolves.toEqual({ outcome: "screened_out" });

    expect(transcribe).not.toHaveBeenCalled();
    expect(repo.setStage.mock.calls).toEqual([
      [payload, runId, "screen_video", 1],
    ]);
    expect(repo.advance).toHaveBeenLastCalledWith(
      payload,
      runId,
      "completed",
      1,
      "VIDEO_OUT_OF_SCOPE",
    );
  });

  it("fails open after a screening error and persists a non-sensitive fallback", async () => {
    const repo = repository();
    const transcribe = transcriber();
    const screen = vi
      .fn<ScreenVideo>()
      .mockRejectedValue(new Error("private model response"));

    await expect(
      executeWorkflow(
        payload,
        runId,
        1,
        repo,
        async () => validVideo(),
        transcribe,
        screen,
      ),
    ).resolves.toEqual({ outcome: "ready_for_claim_extraction" });
    expect(repo.saveScreening).toHaveBeenCalledWith(
      contentId,
      expect.objectContaining({
        decision: "uncertain",
        reasonCode: "provider_error",
        rationale: expect.not.stringContaining("private model response"),
      }),
    );
    expect(transcribe).toHaveBeenCalledOnce();
  });

  it("reuses a persisted screening result on workflow retry", async () => {
    const repo = repository();
    repo.getScreening.mockResolvedValue(
      screening({
        decision: "unrelated",
        reasonCode: "no_checkable_claims",
        confidence: 0.98,
      }),
    );
    const screen = vi.fn<ScreenVideo>();
    const transcribe = transcriber();

    await expect(
      executeWorkflow(
        payload,
        runId,
        2,
        repo,
        async () => validVideo(),
        transcribe,
        screen,
      ),
    ).resolves.toEqual({ outcome: "screened_out" });
    expect(screen).not.toHaveBeenCalled();
    expect(repo.saveScreening).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("does not report success if the generation becomes obsolete during inspection", async () => {
    const repo = repository();
    repo.advance.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);

    await expect(
      executeWorkflow(
        payload,
        runId,
        1,
        repo,
        async () => validVideo(),
        transcriber(),
      ),
    ).resolves.toEqual({ outcome: "obsolete" });
  });

  it.each([
    null,
    content({ storage_path: null }),
    content({ original_file_name: null }),
    content({ storage_path: `${contentId}/${uploadId}.mp4` }),
    content({ storage_path: `${userId}/arbitrary.mp4` }),
    content({ storage_path: `${userId}/${uploadId}.mp4/extra` }),
  ])(
    "rejects unavailable or unowned upload metadata before Storage access",
    async (row) => {
      const repo = repository();
      repo.content.mockResolvedValue(row);
      const inspect = vi.fn<Parameters<typeof executeWorkflow>[4]>();

      await expect(
        executeWorkflow(payload, runId, 1, repo, inspect, transcriber()),
      ).rejects.toThrow(new PermanentWorkflowError("INVALID_UPLOAD"));
      expect(inspect).not.toHaveBeenCalled();
      expect(repo.advance).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0, -1, 0.5, Number.NaN, MAX_VIDEO_SIZE_BYTES + 1])(
    "classifies invalid actual size %s as permanent",
    async (size) => {
      const repo = repository();
      await expect(
        executeWorkflow(
          payload,
          runId,
          1,
          repo,
          async () => validVideo(size),
          transcriber(),
        ),
      ).rejects.toThrow(PermanentWorkflowError);
      expect(repo.advance).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ file_size_bytes: 2048 }, { file_mime_type: "video/webm" }])(
    "rejects changed persisted upload metadata %j",
    async (overrides) => {
      const repo = repository();
      repo.content.mockResolvedValue(content(overrides));
      await expect(
        executeWorkflow(
          payload,
          runId,
          1,
          repo,
          async () => validVideo(),
          transcriber(),
        ),
      ).rejects.toThrow(new PermanentWorkflowError("UPLOAD_CHANGED"));
      expect(repo.advance).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves transient Storage errors for the runner to retry, without completing the job", async () => {
    const repo = repository();
    const failure = new Error("Storage unavailable");
    const inspect = vi
      .fn<Parameters<typeof executeWorkflow>[4]>()
      .mockRejectedValue(failure);

    await expect(
      executeWorkflow(payload, runId, 1, repo, inspect, transcriber()),
    ).rejects.toBe(failure);
    expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
      payload,
      runId,
      "running",
      1,
    );
  });

  it("rejects a same-size object whose bytes are not the expected video container", async () => {
    const repo = repository();
    const inspect = vi
      .fn<Parameters<typeof executeWorkflow>[4]>()
      .mockResolvedValue({
        size: 1024,
        header: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      });

    await expect(
      executeWorkflow(payload, runId, 1, repo, inspect, transcriber()),
    ).rejects.toThrow(PermanentWorkflowError);
    expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
      payload,
      runId,
      "running",
      1,
    );
  });

  it("rejects a generated object path whose extension disagrees with original metadata", async () => {
    const repo = repository();
    repo.content.mockResolvedValue(
      content({ storage_path: `${userId}/${uploadId}.webm` }),
    );

    await expect(
      executeWorkflow(
        payload,
        runId,
        1,
        repo,
        async () => validVideo(),
        transcriber(),
      ),
    ).rejects.toThrow(PermanentWorkflowError);
    expect(repo.advance).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed evidence-stage fence after package persistence", async () => {
    const repo = repository();
    const failure = new Error("Database unavailable");
    repo.setStage.mockResolvedValueOnce(true).mockRejectedValueOnce(failure);
    await expect(
      executeEvidencePackageStage(payload, runId, 1, repo, async () => []),
    ).rejects.toBe(failure);
  });
});

describe("workflow dispatch and recovery", () => {
  it("uses the same idempotency key after an ambiguous trigger failure", async () => {
    const repo = repository();
    const taskRunner = runner();
    const failure = new Error("Connection lost after enqueue");
    taskRunner.start.mockRejectedValueOnce(failure);

    await expect(dispatchJob(job(), repo, taskRunner)).rejects.toBe(failure);
    expect(repo.advance).not.toHaveBeenCalled();
    await dispatchJob(job(), repo, taskRunner);
    expect(taskRunner.start.mock.calls).toEqual([
      [payload, `${jobId}:1`],
      [payload, `${jobId}:1`],
    ]);
  });

  it("uses a distinct idempotency key for an explicitly retried generation", async () => {
    const repo = repository();
    const taskRunner = runner();
    await dispatchJob(job({ generation: 2 }), repo, taskRunner);
    expect(taskRunner.start).toHaveBeenCalledExactlyOnceWith(
      { jobId, generation: 2 },
      `${jobId}:2`,
    );
    expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
      { jobId, generation: 2 },
      runId,
      "queued",
    );
  });

  it("recovers an enqueue whose run attachment failed using the existing idempotency key", async () => {
    const repo = repository();
    const taskRunner = runner();
    const failure = new Error("Run attachment unavailable");
    repo.advance.mockRejectedValueOnce(failure);

    await expect(dispatchJob(job(), repo, taskRunner)).rejects.toBe(failure);
    await dispatchJob(job(), repo, taskRunner);
    expect(taskRunner.start.mock.calls[0]).toEqual(
      taskRunner.start.mock.calls[1],
    );
    expect(repo.advance.mock.calls[0]).toEqual(repo.advance.mock.calls[1]);
  });

  it("returns the persisted completion if the worker finishes before queued attachment", async () => {
    const repo = repository();
    const completed = job({
      status: "completed",
      stage: "complete",
      run_id: runId,
    });
    repo.advance.mockResolvedValue(null);
    repo.get.mockResolvedValue(completed);

    await expect(dispatchJob(job(), repo, runner())).resolves.toEqual(
      completed,
    );
    expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
      payload,
      runId,
      "queued",
    );
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "never redispatches or reconciles terminal %s jobs",
    async (status) => {
      const repo = repository();
      const taskRunner = runner();
      const terminal = job({ status });
      await expect(dispatchJob(terminal, repo, taskRunner)).resolves.toBe(
        terminal,
      );
      await expect(reconcileJob(terminal, repo, taskRunner)).resolves.toBe(
        terminal,
      );
      expect(taskRunner.start).not.toHaveBeenCalled();
      expect(taskRunner.status).not.toHaveBeenCalled();
      expect(repo.advance).not.toHaveBeenCalled();
    },
  );

  it("does not redispatch an already attached run", async () => {
    const repo = repository();
    const taskRunner = runner();
    const attached = job({ run_id: runId });
    await expect(dispatchJob(attached, repo, taskRunner)).resolves.toBe(
      attached,
    );
    expect(taskRunner.start).not.toHaveBeenCalled();
  });

  it("reconciles the persisted queued job even when it has no runner ID", async () => {
    const repo = repository();
    const taskRunner = runner();
    await reconcileJob(job(), repo, taskRunner);
    expect(taskRunner.start).toHaveBeenCalledExactlyOnceWith(
      payload,
      `${jobId}:1`,
    );
    expect(taskRunner.status).not.toHaveBeenCalled();
  });

  it.each([
    ["FAILED", "failed", "RUN_INTERRUPTED"],
    ["CRASHED", "failed", "RUN_INTERRUPTED"],
    ["SYSTEM_FAILURE", "failed", "RUN_INTERRUPTED"],
    ["EXPIRED", "failed", "RUN_INTERRUPTED"],
    ["TIMED_OUT", "failed", "RUN_INTERRUPTED"],
    ["CANCELED", "cancelled", "RUN_INTERRUPTED"],
    ["COMPLETED", "failed", "RESULT_NOT_PERSISTED"],
  ] as const)(
    "recovers runner %s while preserving generation, run ID and attempt",
    async (runnerStatus, dbStatus, errorCode) => {
      const repo = repository();
      const taskRunner = runner();
      taskRunner.status.mockResolvedValue(runnerStatus);
      const active = job({
        status: "running",
        generation: 2,
        attempt: 3,
        run_id: runId,
      });
      const final = job({ ...active, status: dbStatus, error_code: errorCode });
      repo.advance.mockResolvedValue(final);

      await expect(reconcileJob(active, repo, taskRunner)).resolves.toEqual(
        final,
      );
      expect(taskRunner.status).toHaveBeenCalledExactlyOnceWith(runId);
      expect(repo.advance).toHaveBeenCalledExactlyOnceWith(
        { jobId, generation: 2 },
        runId,
        dbStatus,
        3,
        errorCode,
      );
      expect(taskRunner.start).not.toHaveBeenCalled();
    },
  );

  it("re-reads the row if completion wins a race with reconciliation", async () => {
    const repo = repository();
    const taskRunner = runner();
    taskRunner.status.mockResolvedValue("COMPLETED");
    repo.advance.mockResolvedValue(null);
    const completed = job({
      status: "completed",
      stage: "complete",
      run_id: runId,
    });
    repo.get.mockResolvedValue(completed);

    await expect(
      reconcileJob(job({ status: "running", run_id: runId }), repo, taskRunner),
    ).resolves.toEqual(completed);
    expect(repo.get).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it.each(["EXECUTING", "QUEUED", "REATTEMPTING", "WAITING"])(
    "leaves active runner %s unchanged",
    async (status) => {
      const repo = repository();
      const taskRunner = runner();
      taskRunner.status.mockResolvedValue(status);
      const active = job({ status: "running", run_id: runId });

      await expect(reconcileJob(active, repo, taskRunner)).resolves.toBe(
        active,
      );
      expect(repo.advance).not.toHaveBeenCalled();
    },
  );

  it("does not turn a temporary runner API failure into a terminal database failure", async () => {
    const repo = repository();
    const taskRunner = runner();
    const failure = new Error("Runner API unavailable");
    taskRunner.status.mockRejectedValue(failure);

    await expect(
      reconcileJob(job({ run_id: runId }), repo, taskRunner),
    ).rejects.toBe(failure);
    expect(repo.advance).not.toHaveBeenCalled();
  });
});
