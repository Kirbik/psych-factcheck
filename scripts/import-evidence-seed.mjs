import { createClient } from "@supabase/supabase-js";
import { evidenceSeedV0 } from "../src/server/evidence/seed-v0.ts";
import { importEvidenceSeed } from "../src/server/evidence/importer.ts";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
if (process.env.EVIDENCE_IMPORT_CONFIRM !== "IMPORT_EVIDENCE_SEED_V0") {
  throw new Error(
    "Set EVIDENCE_IMPORT_CONFIRM=IMPORT_EVIDENCE_SEED_V0 after checking the target database.",
  );
}
for (const name of requiredEnvironment) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const result = await importEvidenceSeed(client, evidenceSeedV0);
console.log(
  `Imported ${result.source_count} sources and ${result.chunk_count} evidence chunks.`,
);
