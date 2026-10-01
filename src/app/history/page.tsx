import { redirect } from "next/navigation";
import { connection } from "next/server";
import { HistoryPreview } from "@/components/preview/history-preview";
import { createServerAuthClient } from "@/server/supabase/auth";
import { historyRepository } from "@/server/db/history-repository";

export default async function HistoryPage() {
  await connection();
  const client = await createServerAuthClient();
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || typeof claims?.sub !== "string") redirect("/login");

  const result = await historyRepository(client).listOwnedChecks(claims.sub);
  return <HistoryPreview result={result} />;
}
