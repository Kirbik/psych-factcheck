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
    fireEvent.reset(getByRole("form", { name: "Авторизация" }));
    expect(getByLabelText("Электронная почта")).toHaveValue("person@example.com");
    expect(getByLabelText("Пароль")).toHaveValue("safe-password-123");
  });

  it("keeps separate values for login and signup tabs", () => {
    cleanup();
    const { getByLabelText, getByRole } = render(<AuthPreview mode="login" />);

    fireEvent.change(getByLabelText("Электронная почта"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(getByLabelText("Пароль"), {
      target: { value: "safe-password-123" },
    });
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));

    expect(getByLabelText("Электронная почта")).toHaveValue("");
    expect(getByLabelText("Пароль")).toHaveValue("");
    expect(getByLabelText("Повторите пароль")).toHaveValue("");

    fireEvent.change(getByLabelText("Электронная почта"), {
      target: { value: "new-person@example.com" },
    });
    fireEvent.change(getByLabelText("Пароль", { exact: true }), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(getByLabelText("Повторите пароль"), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(getByRole("tab", { name: "Войти" }));

    expect(getByLabelText("Электронная почта")).toHaveValue("person@example.com");
    expect(getByLabelText("Пароль")).toHaveValue("safe-password-123");
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    expect(getByLabelText("Электронная почта")).toHaveValue("new-person@example.com");
    expect(getByLabelText("Пароль", { exact: true })).toHaveValue("new-password-123");
    expect(getByLabelText("Повторите пароль")).toHaveValue("new-password-123");
  });

  it("shows signup field validation errors without clearing values", async () => {
    cleanup();
    const action = vi.fn(async () => ({
      fieldErrors: {
        email: ["Введите корректный email"],
        password: ["Пароль должен содержать минимум 12 символов"],
        passwordRepeat: ["Пароли не совпадают"],
      },
    }));
    const { getByLabelText, getByRole, getByText } = render(
      <AuthPreview actions={{ login: action, signup: action }} mode="signup" />,
    );

    fireEvent.change(getByLabelText("Электронная почта"), {
      target: { value: "invalid" },
    });
    fireEvent.change(getByLabelText("Пароль", { exact: true }), {
      target: { value: "short" },
    });
    fireEvent.change(getByLabelText("Повторите пароль"), {
      target: { value: "different" },
    });
    fireEvent.submit(getByRole("form", { name: "Регистрация" }));

    await vi.waitFor(() => {
      expect(action).toHaveBeenCalled();
      expect(getByText("Введите корректный email")).toBeInTheDocument();
      expect(getByText("Пароль должен содержать минимум 12 символов")).toBeInTheDocument();
      expect(getByText("Пароли не совпадают")).toBeInTheDocument();
    });
    expect(getByLabelText("Электронная почта")).toHaveValue("invalid");
    expect(getByLabelText("Пароль", { exact: true })).toHaveValue("short");
    expect(getByLabelText("Повторите пароль")).toHaveValue("different");
  });
});
