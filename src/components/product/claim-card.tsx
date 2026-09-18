import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import type { Verdict } from "@/types/fact-check";

type ClaimCardProps = {
  children?: ReactNode;
  title: string;
  verdict?: Verdict;
};

export function ClaimCard({ children, title, verdict }: ClaimCardProps) {
  return (
    <Card className="claim-card">
      <div className="claim-card__header">
        <h2>{title}</h2>
        {verdict ? <VerdictBadge verdict={verdict} /> : null}
      </div>
      {children}
    </Card>
  );
}
