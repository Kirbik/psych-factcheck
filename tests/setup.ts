import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ className: "", variable: "" }),
  Lora: () => ({ className: "", variable: "" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
