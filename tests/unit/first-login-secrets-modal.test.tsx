import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  firstLoginSecretsStorageKey,
  type FirstLoginSecrets,
} from "@/features/auth/first-login-secrets";
import { FirstLoginSecretsModal } from "@/components/preview/first-login-secrets-modal";

describe("FirstLoginSecretsModal", () => {
  const showModalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const closeDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    if (showModalDescriptor) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "showModal",
        showModalDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    }
    if (closeDescriptor) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "close",
        closeDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("shows staged secrets once and removes them after confirmation", async () => {
    const secrets: FirstLoginSecrets = {
      token: `pfc_${"a".repeat(64)}`,
      recoveryCode: `pfr_${"b".repeat(64)}`,
    };
    window.sessionStorage.setItem(
      firstLoginSecretsStorageKey,
      JSON.stringify(secrets),
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    });

    render(<FirstLoginSecretsModal />);

    expect(await screen.findByLabelText("Токен авторизации")).toHaveValue(
      secrets.token,
    );
    expect(screen.getByLabelText("Код восстановления")).toHaveValue(
      secrets.recoveryCode,
    );
    fireEvent.click(screen.getByRole("button", { name: "Понятно" }));

    expect(window.sessionStorage.getItem(firstLoginSecretsStorageKey)).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
