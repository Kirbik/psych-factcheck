import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("introduces the project and provides authentication paths", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /Проверяйте заявления/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Создать аккаунт" }),
    ).toBeInTheDocument();
  });
});
