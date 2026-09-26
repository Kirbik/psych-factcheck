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

      expect(
        buttons.every((button) => button.querySelector("svg") === null),
      ).toBe(true);
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

  it("enables registration after server token generation and displays recovery code", async () => {
    const token = `pfc_${"a".repeat(64)}`;
    const generateToken = vi.fn(async () => ({
      generatedToken: token,
      message: "Сохраните токен: повторно показать его будет невозможно.",
    }));
    const signup = vi.fn(async () => ({
      registrationComplete: true,
      recoveryCode: `pfr_${"b".repeat(64)}`,
      message:
        "Сохраните токен авторизации и код восстановления. Они показаны только один раз.",
    }));
    render(
      <AuthPreview
        actions={createActions(undefined, signup, generateToken)}
        mode="signup"
      />,
    );

    expect(screen.getByLabelText("Токен регистрации")).toHaveValue("");
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

    expect(screen.getByRole("button", { name: "Регистрация" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Регистрация" }));
    await vi.waitFor(() => {
      expect(signup).toHaveBeenCalled();
      expect(
        screen.getByText(
          "Сохраните токен авторизации и код восстановления. Они показаны только один раз.",
        ),
      ).toHaveAttribute("role", "status");
    });
    const historyLink = screen.getByRole("link", {
      name: "Перейти к проверкам",
    });
    expect(historyLink).toHaveAttribute("href", "/ui-preview/history");
    expect(historyLink.querySelector("svg")).not.toBeInTheDocument();
    const completedToken = screen.getByLabelText("Токен регистрации");
    const completedCopyButton = screen.getByRole("button", {
      name: "Скопировать токен",
    });
    expect(completedCopyButton.parentElement).toContainElement(completedToken);
    expect(screen.getByLabelText("Код восстановления")).toHaveValue(
      `pfr_${"b".repeat(64)}`,
    );
    expect(
      screen.getByRole("button", { name: "Скопировать код восстановления" })
        .parentElement,
    ).toContainElement(screen.getByLabelText("Код восстановления"));
  });

  it("clears copy feedback when registration is submitted", async () => {
    const token = `pfc_${"c".repeat(64)}`;
    const generateToken = vi.fn(async () => ({ generatedToken: token }));
    const signup = vi.fn(async () => ({
      registrationComplete: true,
      recoveryCode: `pfr_${"d".repeat(64)}`,
      message: "Регистрация завершена.",
    }));
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AuthPreview
        actions={createActions(undefined, signup, generateToken)}
        mode="signup"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать" }));
    await vi.waitFor(() => {
      expect(screen.getByLabelText("Токен регистрации")).toHaveValue(token);
    });
    const tokenInput = screen.getByLabelText("Токен регистрации");
    const copyButton = screen.getByRole("button", {
      name: "Скопировать токен",
    });
    expect(copyButton.parentElement).toContainElement(tokenInput);
    expect(copyButton.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(token);
      expect(screen.getByRole("status")).toHaveTextContent("Токен скопирован");
    });

    fireEvent.click(screen.getByRole("button", { name: "Регистрация" }));
    await vi.waitFor(() => {
      expect(signup).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("link", { name: "Перейти к проверкам" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Токен скопирован")).not.toBeInTheDocument();

    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("keeps login and registration tokens separate across tabs", async () => {
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
      expect(getByLabelText("Токен регистрации")).toHaveValue(
        `pfc_${"b".repeat(64)}`,
      );
    });
    fireEvent.click(getByRole("tab", { name: "Войти" }));

    expect(getByLabelText("Токен авторизации")).toHaveValue("login-token");
    fireEvent.click(getByRole("tab", { name: "Регистрация" }));
    expect(getByLabelText("Токен регистрации")).toHaveValue(
      `pfc_${"b".repeat(64)}`,
    );
    expect(screen.queryByLabelText("Кодовое слово")).not.toBeInTheDocument();
  });
});
