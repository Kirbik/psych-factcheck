import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type EvidenceCardProps = {
  children?: ReactNode;
  title: string;
  meta?: string;
};

export function EvidenceCard({ children, meta, title }: EvidenceCardProps) {
  return (
    <Card className="evidence-card">
      <h3>{title}</h3>
      {meta ? <p className="muted-text">{meta}</p> : null}
      {children}
    </Card>
  );
}
