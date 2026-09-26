import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthActionState } from "@/features/auth/state";
import { AuthPreview } from "@/components/preview/auth-preview";

type Action = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

function createActions(
  login: Action = async () => ({}),
  signup: Action = async () => ({}),
  generateToken: Action = async () => ({}),
) {
  return { generateToken, login, signup };
}

describe("AuthPreview", () => {
  afterEach(() => cleanup());

  it("renders token login and registration tabs", () => {
    render(<AuthPreview actions={createActions()} mode="login" />);

    expect(screen.getByLabelText("Токен авторизации")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Регистрация" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders recovery information without an input", () => {
    const { container } = render(
      <AuthPreview actions={createActions()} mode="reset" />,
    );
    const preview = within(container);

    expect(
      preview.getByRole("heading", { name: "Восстановление доступа" }),
    ).toBeInTheDocument();
    expect(
      preview.queryByLabelText("Токен авторизации"),
    ).not.toBeInTheDocument();
  });

  it("does not render decorative arrow icons in auth buttons", () => {
    for (const mode of ["login", "signup", "reset"] as const) {
      const { container, unmount } = render(
        <AuthPreview actions={createActions()} mode={mode} />,
      );
      const buttons = within(container).getAllByRole("button");

      expect(buttons.every((button) => button.querySelector("svg") === null)).toBe(
        true,
      );
      unmount();
    }
  });

  it("uses the server action for token login and preserves the entered token on error", async () => {
    const login = vi.fn(async () => ({
      message: "Токен авторизации введён неверно",
    }));
    render(<AuthPreview actions={createActions(login)} mode="login" />);

    fireEvent.change(screen.getByLabelText("Токен авторизации"), {
      target: { value: "pfc_invalid" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Авторизация" }));

    await vi.waitFor(() => {
      expect(login).toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Токен авторизации введён неверно",
      );
    });
    expect(screen.getByLabelText("Токен авторизации")).toHaveValue(
      "pfc_invalid",
    );
  });

  it("enables registration only after server token generation and valid codeword entry", async () => {
    const token = `pfc_${"a".repeat(64)}`;
    const generateToken = vi.fn(async () => ({
      generatedToken: token,
      message: "Сохраните токен: повторно показать его будет невозможно.",
    }));
    const signup = vi.fn(async () => ({
      registrationComplete: true,
      message: "Регистрация завершена. Сохраните токен для следующих входов.",
    }));
    render(
      <AuthPreview
        actions={createActions(undefined, signup, generateToken)}
        mode="signup"
      />,
    );

    expect(screen.getByLabelText("Токен регистрации")).toHaveValue("");
    expect(screen.getByLabelText("Кодовое слово")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Регистрация" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать" }));
    await vi.waitFor(() => {
      expect(generateToken).toHaveBeenCalledOnce();
      expect(screen.getByLabelText("Токен регистрации")).toHaveValue(token);
    });
    const tokenNotice = screen.getByRole("status");
    expect(tokenNotice).toHaveTextContent(
      "Сохраните токен: повторно показать его будет невозможно.",
    );
    expect(tokenNotice.className).toContain("tokenNotice");

    const codeword = screen.getByLabelText("Кодовое слово");
    expect(codeword).toBeEnabled();
    fireEvent.change(codeword, { target: { value: "secret phrase" } });
    expect(screen.getByRole("button", { name: "Регистрация" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Регистрация" }));
    await vi.waitFor(() => {
      expect(signup).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Регистрация завершена.",
      );
    });
    const historyLink = screen.getByRole("link", {
      name: "Перейти к проверкам",
    });
    expect(historyLink).toHaveAttribute("href", "/ui-preview/history");
    expect(historyLink.querySelector("svg")).not.toBeInTheDocument();
  });

  it("keeps login token and registration codeword separate across tabs", async () => {
    const generateToken = vi.fn(async () => ({
      generatedToken: `pfc_${"b".repeat(64)}`,
    }));
    const { getByLabelText, getByRole } = render(
      <AuthPreview
        actions={createActions(undefined, undefined, generateToken)}
        mode="login"
      />,
    );

    fireEvent.change(getByLabelText("Токен авторизации"), {
      target: { value: "login-token" },
    });
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    fireEvent.click(getByRole("button", { name: "Сгенерировать" }));
    await vi.waitFor(() => {
      expect(getByLabelText("Кодовое слово")).toBeEnabled();
    });
    fireEvent.change(getByLabelText("Кодовое слово"), {
      target: { value: "registration-word" },
    });
    fireEvent.click(getByRole("tab", { name: "Войти" }));

    expect(getByLabelText("Токен авторизации")).toHaveValue("login-token");
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    expect(getByLabelText("Кодовое слово")).toHaveValue("registration-word");
  });
});
