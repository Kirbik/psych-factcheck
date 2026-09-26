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

function createActions(
  login: (
    state: AuthActionState,
    formData: FormData,
  ) => Promise<AuthActionState> = async () => ({}),
  signup: (
    state: AuthActionState,
    formData: FormData,
  ) => Promise<AuthActionState> = async () => ({}),
) {
  return { login, signup };
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

  it("submits the codeword and shows the token returned by the server", async () => {
    const token = `pfc_${"a".repeat(64)}`;
    const signup = vi.fn(async () => ({
      generatedToken: token,
      message: "Сохраните токен. Повторно показать его будет невозможно.",
    }));
    render(
      <AuthPreview actions={createActions(undefined, signup)} mode="signup" />,
    );

    fireEvent.change(screen.getByLabelText("Кодовое слово"), {
      target: { value: "secret phrase" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Регистрация" }));

    await vi.waitFor(() => {
      expect(signup).toHaveBeenCalled();
      expect(screen.getByLabelText("Токен авторизации")).toHaveValue(token);
    });
    expect(
      screen.getByRole("link", { name: "Перейти к проверкам" }),
    ).toHaveAttribute("href", "/ui-preview/history");
  });

  it("keeps login token and registration codeword separate across tabs", () => {
    const { getByLabelText, getByRole } = render(
      <AuthPreview actions={createActions()} mode="login" />,
    );

    fireEvent.change(getByLabelText("Токен авторизации"), {
      target: { value: "login-token" },
    });
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    fireEvent.change(getByLabelText("Кодовое слово"), {
      target: { value: "registration-word" },
    });
    fireEvent.click(getByRole("tab", { name: "Войти" }));

    expect(getByLabelText("Токен авторизации")).toHaveValue("login-token");
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    expect(getByLabelText("Кодовое слово")).toHaveValue("registration-word");
  });
});
