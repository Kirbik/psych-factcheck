import { ProcessingPreview } from "@/components/preview/processing-preview";
import { WorkflowProgress } from "@/features/analysis/workflow-progress";
import { z } from "zod";

export default async function ProcessingPage({
  searchParams,
}: {
  searchParams: Promise<{ contentItemId?: string }>;
}) {
  const id = z.uuid().safeParse((await searchParams).contentItemId);
  return id.success ? (
    <WorkflowProgress key={id.data} contentItemId={id.data} />
  ) : (
    <ProcessingPreview />
  );
}
