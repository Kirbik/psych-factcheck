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

test("restores the interrupted upload screen after a page reload", async ({
  page,
}) => {
  const uploadId = "55555555-5555-4555-8555-555555555555";
  const serverResponse = await page.request.get("/new-check");
  expect(await serverResponse.text()).not.toContain(
    "Видео сохранено. Получаем состояние подготовки.",
  );
  await page.addInitScript(
    ({ key, state }) =>
      window.sessionStorage.setItem(key, JSON.stringify(state)),
    {
      key: "psych-factcheck:active-content-item:v1",
      state: {
        kind: "uploading",
        uploadId,
        fileName: "lesson.mp4",
        fileSizeBytes: 12_000,
        lastModified: 1_234,
        progressPercent: 42,
      },
    },
  );

  await page.goto("/new-check");
  await expect(
    page.getByRole("heading", { name: "Загрузка приостановлена" }),
  ).toBeVisible();
  await expect(page.getByText("Приостановлено · 42%")).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Приостановлено · 42%" })
      .getByRole("button", { name: "Продолжить загрузку" }),
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Загрузка приостановлена" }),
  ).toBeVisible();
  await expect(page.getByText("Приостановлено · 42%")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Новая проверка" }),
  ).toHaveCount(0);
});

test("shows durable progress after reload without claiming AI completion", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/analysis**", async (route) => {
    requests += 1;
    const completed = requests > 2;
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
  expect(requests).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByText(
      "Транскрипт и проверяемые утверждения сохранены. Фактчекинг пока недоступен.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Перейти к отчету" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.locator("li").filter({ hasText: "Создание транскрипта" }),
  ).toContainText("Готово");
});

test("shows a screened-out outcome without marking transcription complete", async ({
  page,
}) => {
  await page.route("**/api/analysis**", (route) =>
    route.fulfill({
      json: {
        job: {
          ...job,
          status: "completed",
          stage: "complete",
          error_code: "VIDEO_OUT_OF_SCOPE",
        },
      },
    }),
  );
  await page.goto(`/processing?contentItemId=${contentId}`);

  await expect(
    page.getByText(
      "Видео не подходит для психологического фактчекинга. Полная транскрибация не выполнялась.",
    ),
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Создание транскрипта" }),
  ).not.toContainText("Готово");
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
      "Транскрипт и проверяемые утверждения сохранены. Фактчекинг пока недоступен.",
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Видео сохранено",
  );
  await expect(
    page.getByRole("button", { name: "Повторить запуск" }),
  ).toBeEnabled();
  await expect(
    page.locator("li").filter({ hasText: "Загрузка видео" }),
  ).toContainText("Готово");
});
