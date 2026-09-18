import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisStatus } from "@/components/ui/analysis-status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerdictBadge } from "@/components/ui/verdict-badge";

describe("UI primitives", () => {
  it("keeps controls named and available to keyboard users", () => {
    render(<><Label htmlFor="email">Эл. почта</Label><Input id="email" /><Button>Продолжить</Button></>);

    expect(screen.getByLabelText("Эл. почта")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeEnabled();
  });

  it("exposes loading and error states without relying on color", () => {
    render(<><Button loading>Сохранить</Button><Alert tone="error">Ошибка</Alert></>);

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Ошибка");
  });

  it("renders textual verdict and analysis status labels", () => {
    render(<><VerdictBadge verdict="CONTRADICTED" /><AnalysisStatus status="processing" /></>);

    expect(screen.getByText("Расходится с данными")).toBeInTheDocument();
    expect(screen.getByText("Выполняется")).toBeInTheDocument();
  });
});
