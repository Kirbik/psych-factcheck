import { test, expect } from "@playwright/test";

const contentId = "33333333-3333-4333-8333-333333333333";
const job = {
  id: "44444444-4444-4444-8444-444444444444",
  generation: 1,
  status: "queued",
  stage: "queued",
  attempt: 0,
  error_code: null,
};

test("shows durable progress after reload without claiming AI completion", async ({
  page,
}) => {
  let completed = false;
  await page.route("**/api/analysis**", async (route) => {
    if (route.request().method() === "GET") completed = true;
    await route.fulfill({
      json: {
        job: completed
          ? { ...job, status: "completed", stage: "complete", attempt: 1 }
          : job,
      },
    });
  });
  await page.goto(`/processing?contentItemId=${contentId}`);
  await expect(
    page.getByText("Видео загружено. Подготовка к анализу ожидает запуска."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Видео готово к следующим этапам. Транскрипция и анализ пока недоступны.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      "Видео готово к следующим этапам. Транскрипция и анализ пока недоступны.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Перейти к отчету" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.locator("li").filter({ hasText: "Создание транскрипта" }),
  ).toContainText("Ожидает");
});

test("retries a failed generation explicitly", async ({ page }) => {
  let retried = false;
  await page.route("**/api/analysis**", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().retryGeneration === 1
    )
      retried = true;
    await route.fulfill({
      json: {
        job: retried
          ? { ...job, generation: 2, status: "completed", stage: "complete" }
          : { ...job, status: "failed", error_code: "WORKFLOW_FAILED" },
      },
    });
  });
  await page.goto(`/processing?contentItemId=${contentId}`);
  await page.getByRole("button", { name: "Повторить запуск" }).click();
  await expect(
    page.getByText(
      "Видео готово к следующим этапам. Транскрипция и анализ пока недоступны.",
    ),
  ).toBeVisible();
  expect(retried).toBe(true);
});

test("keeps upload success separate from unavailable workflow", async ({
  page,
}) => {
  await page.route("**/api/analysis**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Фоновая обработка пока не настроена. Видео сохранено." },
    }),
  );
  await page.goto(`/processing?contentItemId=${contentId}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Видео сохранено");
  await expect(
    page.getByRole("button", { name: "Повторить запуск" }),
  ).toBeEnabled();
  await expect(
    page.locator("li").filter({ hasText: "Загрузка видео" }),
  ).toContainText("Готово");
});
