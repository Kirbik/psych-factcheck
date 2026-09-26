import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePreview } from "@/components/preview/profile-preview";

vi.mock("@/features/auth/actions", () => ({ signOut: vi.fn() }));

describe("ProfilePreview", () => {
  afterEach(() => cleanup());

  it("keeps the profile screen without email or password forms", () => {
    render(<ProfilePreview />);

    expect(screen.getByRole("heading", { name: "Профиль" })).toBeInTheDocument();
    const logoutButton = screen.getByRole("button", { name: "Выйти" });
    expect(logoutButton).toBeInTheDocument();
    expect(logoutButton).toHaveAttribute("type", "submit");
    expect(logoutButton.closest("form")).toBeInTheDocument();
    expect(screen.queryByLabelText("Адрес почты")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
