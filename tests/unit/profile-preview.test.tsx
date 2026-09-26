import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfilePreview } from "@/components/preview/profile-preview";

describe("ProfilePreview", () => {
  afterEach(() => cleanup());

  it("keeps the profile screen without email or password forms", () => {
    render(<ProfilePreview />);

    expect(screen.getByRole("heading", { name: "Профиль" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Адрес почты")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
