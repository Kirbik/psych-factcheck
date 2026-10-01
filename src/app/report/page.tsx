import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { ReportPreview } from "@/components/preview/report-preview";
import { createServerAuthClient } from "@/server/supabase/auth";
import { reportRepository } from "@/server/db/report-repository";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ contentItemId?: string | string[] }>;
}) {
  await connection();
  const contentItemId = (await searchParams).contentItemId;
  if (contentItemId === undefined) {
    return <ReportPreview result={{ kind: "not_found" }} />;
  }
  const parsedContentItemId = z.uuid().safeParse(contentItemId);
  if (!parsedContentItemId.success) notFound();

  const client = await createServerAuthClient();
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || typeof claims?.sub !== "string") redirect("/login");

  const result = await reportRepository(client).getOwnedReport(
    parsedContentItemId.data,
    claims.sub,
  );
  if (result.kind === "not_found") notFound();
  return <ReportPreview result={result} />;
}
