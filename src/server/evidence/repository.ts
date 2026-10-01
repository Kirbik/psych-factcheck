import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type EvidenceClient = SupabaseClient<Database>;

export const evidenceRepository = {
  listActiveSources(client: EvidenceClient) {
    return client
      .from("sources")
      .select()
      .eq("status", "active")
      .order("published_at", { ascending: false });
  },

  findSourceByDoi(client: EvidenceClient, doi: string) {
    return client.from("sources").select().eq("doi", doi).maybeSingle();
  },

  listChunksForSource(client: EvidenceClient, sourceId: string) {
    return client
      .from("evidence_chunks")
      .select()
      .eq("source_id", sourceId)
      .order("chunk_key", { ascending: true });
  },
};
