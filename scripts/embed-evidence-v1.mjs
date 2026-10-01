import { createClient } from "@supabase/supabase-js";
import { createOpenAIEmbeddingProvider } from "../src/server/ai/openai-embedding-provider.ts";
import { EMBEDDING_VERSION } from "../src/server/ai/embeddings.ts";
import { embedEvidenceChunks } from "../src/server/evidence/embeddings.ts";
import { searchEvidence } from "../src/server/evidence/search.ts";
import relevanceDataset from "../evals/fixtures/retrieval-v1.json" with { type: "json" };

const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const targetRef = targetUrl ? new URL(targetUrl).hostname.split(".")[0] : "";
const expectedRef = process.env.EVIDENCE_EMBEDDING_PROJECT_REF;
if (
  !targetUrl ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.OPENAI_API_KEY
) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY.",
  );
}
if (process.env.EVIDENCE_EMBEDDING_CONFIRM !== "EMBED_EVIDENCE_V1") {
  throw new Error(
    "Set EVIDENCE_EMBEDDING_CONFIRM=EMBED_EVIDENCE_V1 after checking the target project.",
  );
}
if (!expectedRef || expectedRef !== targetRef) {
  throw new Error(
    "Set EVIDENCE_EMBEDDING_PROJECT_REF to the exact Supabase project ref in the target URL.",
  );
}

const client = createClient(targetUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const [
  { data: chunks, error: chunksError },
  { data: saved, error: savedError },
] = await Promise.all([
  client
    .from("evidence_chunks")
    .select("id,content,content_sha256")
    .order("id"),
  client
    .from("evidence_embeddings")
    .select("evidence_chunk_id,content_sha256")
    .eq("embedding_version", EMBEDDING_VERSION),
]);
if (chunksError || savedError || !chunks || !saved) {
  throw new Error("Could not read the evidence catalog or its embeddings.");
}

const currentDigests = new Map(
  saved.map((embedding) => [
    embedding.evidence_chunk_id,
    embedding.content_sha256,
  ]),
);
const pending = chunks
  .filter((chunk) => currentDigests.get(chunk.id) !== chunk.content_sha256)
  .map((chunk) => ({ id: chunk.id, content: chunk.content }));
const provider = createOpenAIEmbeddingProvider(process.env.OPENAI_API_KEY);
if (pending.length > 0) {
  await embedEvidenceChunks(client, provider, pending);
}

const results = await Promise.all(
  relevanceDataset.cases.map(async (testCase) => {
    const result = await searchEvidence(client, provider, testCase.query, {
      language: "en",
      limit: 5,
    });
    const relevant = new Set(testCase.relevantChunkKeys);
    const precision =
      result.candidates.filter((candidate) => relevant.has(candidate.chunkKey))
        .length / 5;
    return { caseId: testCase.id, precisionAt5: precision };
  }),
);
const meanPrecision =
  results.reduce((total, result) => total + result.precisionAt5, 0) /
  results.length;
console.log(
  JSON.stringify({
    retrievalDataset: relevanceDataset.datasetVersion,
    meanPrecisionAt5: meanPrecision,
    cases: results,
  }),
);
console.log(
  `Embedded ${pending.length} changed evidence chunks; ${chunks.length - pending.length} current vectors were reused.`,
);
