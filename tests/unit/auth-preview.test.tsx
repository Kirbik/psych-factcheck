import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthPreview } from "@/components/preview/auth-preview";

describe("AuthPreview", () => {
  it("keeps the login preview accessible", () => {
    render(<AuthPreview mode="login" />);

    expect(screen.getByLabelText("Электронная почта")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Регистрация" })).toHaveAttribute(
      "href",
      "/?mode=signup",
    );
  });

  it("renders a recovery preview without a password field", () => {
    const { container } = render(<AuthPreview mode="reset" />);
    const preview = within(container);

    expect(preview.getByRole("heading", { name: "Восстановить пароль" })).toBeInTheDocument();
    expect(preview.queryByLabelText("Пароль")).not.toBeInTheDocument();
  });

  it("keeps the login tab on the preview login route", () => {
    const { container } = render(<AuthPreview mode="signup" />);
    const loginTab = container.querySelector<HTMLAnchorElement>(
      'a[role="tab"][href="/"]',
    );

    expect(loginTab).toBeInTheDocument();
  });

  it("submits credentials through the supplied auth action", async () => {
    cleanup();
    const action = vi.fn(async () => ({ message: "Неверный email или пароль" }));
    const { getByLabelText, getByRole } = render(
      <AuthPreview actions={{ login: action, signup: action }} mode="login" />,
    );

    fireEvent.change(getByLabelText("Электронная почта"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(getByLabelText("Пароль"), {
      target: { value: "safe-password-123" },
    });
    fireEvent.submit(getByRole("form", { name: "Авторизация" }));

    await vi.waitFor(() => {
      expect(action).toHaveBeenCalled();
      expect(getByRole("alert")).toHaveTextContent("Неверный email или пароль");
    });
    expect(getByLabelText("Электронная почта")).toHaveValue("person@example.com");
    expect(getByLabelText("Пароль")).toHaveValue("safe-password-123");
  });
});
