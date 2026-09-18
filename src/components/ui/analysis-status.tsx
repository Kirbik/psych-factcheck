import { Badge } from "@/components/ui/badge";

export type AnalysisStatusValue = "completed" | "processing" | "failed" | "pending";

const statusContent: Record<AnalysisStatusValue, { icon: string; label: string }> = {
  completed: { icon: "✓", label: "Готово" },
  processing: { icon: "◌", label: "Выполняется" },
  failed: { icon: "×", label: "Не удалось завершить" },
  pending: { icon: "○", label: "Ожидает" },
};

export function AnalysisStatus({ status }: { status: AnalysisStatusValue }) {
  const content = statusContent[status];
  return <Badge icon={content.icon}>{content.label}</Badge>;
}
