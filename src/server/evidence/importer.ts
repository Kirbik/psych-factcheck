import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  evidenceSeedSchema,
  sha256,
  toImportRows,
  type EvidenceSeed,
} from "./seed-v0.ts";

/** Imports reviewed seed data through the service-only, transactional SQL function. */
export async function importEvidenceSeed(
  client: SupabaseClient<Database>,
  input: EvidenceSeed,
) {
  const seed = evidenceSeedSchema.parse(input);
  const rows = toImportRows(seed);
  for (const [index, chunk] of rows.chunks.entries()) {
    const original = seed.chunks[index];
    if (!original || chunk.content_sha256 !== sha256(original.content)) {
      throw new Error(`Evidence content hash mismatch at chunk ${index}`);
    }
  }

  const { data, error } = await client.rpc("import_evidence_seed", {
    p_sources: rows.sources,
    p_chunks: rows.chunks,
  });
  if (error) throw new Error(`Evidence seed import failed: ${error.message}`);
  const result = data?.[0];
  if (
    !result ||
    result.source_count !== seed.sources.length ||
    result.chunk_count !== seed.chunks.length
  ) {
    throw new Error("Evidence seed import returned unexpected counts");
  }
  return result;
}
