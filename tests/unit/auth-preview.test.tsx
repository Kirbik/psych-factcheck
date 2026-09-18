import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthPreview } from "@/components/preview/auth-preview";

describe("AuthPreview", () => {
  it("keeps the login preview accessible and explicitly non-production", () => {
    render(<AuthPreview mode="login" />);

    expect(screen.getByLabelText("Электронная почта")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Регистрация" })).toHaveAttribute(
      "href",
      "/ui-preview/auth?mode=signup",
    );
  });

  it("renders a recovery preview without a password field", () => {
    const { container } = render(<AuthPreview mode="reset" />);
    const preview = within(container);

    expect(preview.getByRole("heading", { name: "Восстановить пароль" })).toBeInTheDocument();
    expect(preview.queryByLabelText("Пароль")).not.toBeInTheDocument();
  });
});
