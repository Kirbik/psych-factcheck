import { type Verdict } from "@/types/fact-check";
import { Badge } from "@/components/ui/badge";

const verdictContent: Record<Verdict, { icon: string; label: string }> = {
  SUPPORTED: { icon: "✓", label: "Соответствует данным" },
  MOSTLY_SUPPORTED: { icon: "≈", label: "В основном соответствует данным" },
  OVERSIMPLIFIED: { icon: "≈", label: "Упрощает данные" },
  INSUFFICIENT_EVIDENCE: { icon: "?", label: "Недостаточно данных" },
  CONTRADICTED: { icon: "×", label: "Расходится с данными" },
  UNVERIFIABLE: { icon: "?", label: "Невозможно проверить" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const content = verdictContent[verdict];
  return <Badge icon={content.icon}>{content.label}</Badge>;
}
