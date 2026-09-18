import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";

type PageHeaderProps = {
  actions?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
};

export function PageHeader({ actions, description, eyebrow, title }: PageHeaderProps) {
  return (
    <Container className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </Container>
  );
}
