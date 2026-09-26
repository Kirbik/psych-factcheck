import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthPreview } from "@/components/preview/auth-preview";

describe("AuthPreview secret phrase length", () => {
  it("counts only non-whitespace characters and enforces the 3–100 range", () => {
    render(<AuthPreview mode="signup" />);

    fireEvent.click(screen.getByRole("button", { name: "Создать токен регистрации" }));
    const phraseInput = screen.getByLabelText("Секретное слово");
    const submitButton = screen.getByRole("button", { name: "Зарегистрироваться" });

    fireEvent.change(phraseInput, { target: { value: "a b" } });
    fireEvent.click(submitButton);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Введите от 3 до 100 символов, не считая пробелы.",
    );
    expect(phraseInput).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(phraseInput, { target: { value: "a b c" } });
    fireEvent.click(submitButton);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Регистрация по токену пока не подключена к серверу.",
    );

    fireEvent.change(phraseInput, { target: { value: "x".repeat(101) } });
    fireEvent.click(submitButton);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Введите от 3 до 100 символов, не считая пробелы.",
    );
  });
});
