import { expect, test } from "@playwright/test";

const authEnvironmentIsConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const loginEnvironmentIsConfigured = Boolean(
  authEnvironmentIsConfigured && process.env.E2E_SUPABASE_TOKEN,
);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByLabel("Токен авторизации")
    .fill(process.env.E2E_SUPABASE_TOKEN!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/history$/);
}

test("opens token login from the home page", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/Psych Factcheck/);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Вход в аккаунт" }),
  ).toBeVisible();
  await expect(page.getByLabel("Токен авторизации")).toBeVisible();
});

test("keeps the checks preview available", async ({ page }) => {
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Все проверки" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Проверки", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("redirects legacy preview addresses to clean section paths", async ({
  page,
}) => {
  const routes = [
    ["/ui-preview/auth?mode=signup", "/auth?mode=signup"],
    ["/ui-preview/history", "/history"],
    ["/ui-preview/new-check", "/new-check"],
    ["/ui-preview/processing", "/processing"],
    ["/ui-preview/profile", "/profile"],
    ["/ui-preview/report", "/report"],
  ] as const;

  for (const [legacyPath, cleanPath] of routes) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(new RegExp(`${cleanPath.replace("?", "\\?")}$`));
  }
});

test("requires token generation before registration and clears registration state on reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Токен авторизации").fill(`pfc_${"a".repeat(64)}`);
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await expect(page).toHaveURL(/\/?mode=signup$/);
  await expect(
    page.getByRole("heading", { name: "Создайте аккаунт" }),
  ).toBeVisible();
  await expect(page.getByLabel("Токен регистрации")).toHaveValue("");
  const registrationButton = page.getByRole("button", {
    name: "Регистрация",
  });
  await expect(
    registrationButton,
  ).toBeDisabled();
  const tokenRowBox = await page
    .getByLabel("Токен регистрации")
    .locator("xpath=../..")
    .boundingBox();
  const registrationButtonBox = await registrationButton.boundingBox();
  if (!tokenRowBox || !registrationButtonBox) {
    throw new Error("Registration controls must be visible");
  }
  expect(
    registrationButtonBox.y - (tokenRowBox.y + tokenRowBox.height),
  ).toBeGreaterThanOrEqual(20);

  await page.getByRole("tab", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Токен авторизации")).toHaveValue(
    `pfc_${"a".repeat(64)}`,
  );
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await expect(page.getByLabel("Токен регистрации")).toHaveValue("");

  await page.reload();
  await expect(page.getByLabel("Токен регистрации")).toHaveValue("");
  await page.goto("/");
  await expect(page.getByLabel("Токен авторизации")).toHaveValue("");
  await page.goto("/?mode=reset");
  await expect(
    page.getByRole("heading", { name: "Восстановление доступа" }),
  ).toBeVisible();
});

test("uploads the selected video before continuing", async ({ page }) => {
  let uploadRequestBody = "";
  let notifyRequestStarted: () => void = () => undefined;
  let finishUpload: () => void = () => undefined;
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequestStarted = resolve;
  });
  const uploadResponseAllowed = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route("**/api/uploads/video", async (route) => {
    expect(route.request().method()).toBe("POST");
    uploadRequestBody = route.request().postDataBuffer()?.toString() ?? "";
    notifyRequestStarted();
    await uploadResponseAllowed;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ contentItemId: "content-item-id", duplicate: false }),
    });
  });

  await page.goto("/new-check");
  await page.setInputFiles("#video-file", {
    name: "e2e-video.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
  });
  await page.getByRole("button", { name: "Продолжить" }).click();

  await requestStarted;
  await expect(
    page.getByRole("heading", { name: "Загружаем видео" }),
  ).toBeVisible();
  const uploadStep = page.locator("li").filter({ hasText: "Загрузка видео" });
  await expect(uploadStep).toContainText("Выполняется");
  expect(uploadRequestBody).toContain('name="video"');
  expect(uploadRequestBody).toContain('name="upload_id"');
  finishUpload();
  await expect(uploadStep).toContainText("Готово");
  await expect(
    page.locator("li").filter({ hasText: "Создание транскрипта" }),
  ).toContainText("Ожидает");
  await expect(page).toHaveURL(/\/new-check$/);
});

test("marks the upload stage as failed when the server rejects the video", async ({
  page,
}) => {
  await page.route("**/api/uploads/video", (route) =>
    route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({ error: "Размер запроса превышает допустимый предел." }),
    }),
  );

  await page.goto("/new-check");
  await page.setInputFiles("#video-file", {
    name: "too-large.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
  });
  await page.getByRole("button", { name: "Продолжить" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "Размер запроса превышает допустимый предел.",
  );
  await expect(
    page.getByRole("heading", { name: "Не удалось загрузить видео" }),
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Загрузка видео" }),
  ).toContainText("Ошибка");
  await expect(page).toHaveURL(/\/new-check$/);
});

test.describe("authentication", () => {
  test.skip(
    !authEnvironmentIsConfigured,
    "Requires Supabase URL, public key, and server-only service-role key.",
  );

  test("redirects an unauthenticated visitor away from the dashboard", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Токен авторизации")).toBeVisible();
  });

  test("creates a server-generated token during registration", async ({
    page,
  }) => {
    await page.goto("/?mode=signup");
    await expect(
      page.getByRole("button", { name: "Регистрация" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Сгенерировать" }).click();
    await expect(page.getByLabel("Токен регистрации")).toHaveValue(
      /^pfc_[a-f0-9]{64}$/,
    );
    await expect(
      page.getByRole("button", { name: "Регистрация" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Регистрация" }).click();
    const registrationDialog = page.getByRole("dialog", {
      name: "Регистрация прошла успешно",
    });
    await expect(registrationDialog).toBeVisible();
    await expect(page.getByLabel("Токен регистрации")).toHaveValue("");
    await expect(page.getByLabel("Токен регистрации")).toHaveAttribute(
      "placeholder",
      "Появится после создания",
    );
    await expect(
      page.getByRole("button", { name: "Сгенерировать" }),
    ).toBeDisabled();
    await expect(registrationDialog).not.toContainText(/^pfc_[a-f0-9]{64}$/);
    await registrationDialog.getByRole("button", { name: "Понятно" }).click();
    await expect(registrationDialog).not.toBeVisible();
    await page.getByRole("button", { name: "Перейти к проверкам" }).click();
    await expect(page).toHaveURL(/\/history$/);

    const firstLoginDialog = page.getByRole("dialog", {
      name: "Сохраните данные для доступа",
    });
    await expect(firstLoginDialog).toBeVisible();
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 800, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await firstLoginDialog.boundingBox();
      const viewportCenter = await page.evaluate(() => ({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }));
      if (!bounds) {
        throw new Error("First-login secrets dialog must have visible bounds");
      }
      expect(Math.abs(bounds.x + bounds.width / 2 - viewportCenter.x)).toBeLessThan(2);
      expect(Math.abs(bounds.y + bounds.height / 2 - viewportCenter.y)).toBeLessThan(2);
    }
    await expect(firstLoginDialog.getByLabel("Токен авторизации")).toHaveValue(
      /^pfc_[a-f0-9]{64}$/,
    );
    await expect(firstLoginDialog.getByLabel("Код восстановления")).toHaveValue(
      /^pfr_[a-f0-9]{64}$/,
    );
    await firstLoginDialog.getByRole("button", { name: "Понятно" }).click();
    await expect(firstLoginDialog).not.toBeVisible();
  });

  test("allows an existing user to log in", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires a valid E2E_SUPABASE_TOKEN for a confirmed test user.",
    );

    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Все проверки" }),
    ).toBeVisible();
  });

  test("ends the session from the profile screen", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires a valid E2E_SUPABASE_TOKEN for a confirmed test user.",
    );

    await signIn(page);
    await page.goto("/profile");
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/$/);
  });

  test("uploads one valid video and shows completion", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires a valid token and Supabase Storage test environment.",
    );

    await signIn(page);
    await page.goto("/dashboard");
    await page.setInputFiles("#video-upload-file", {
      name: "e2e-video.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
    });
    await page.getByRole("button", { name: "Загрузить видео" }).click();
    await expect(page.getByRole("status")).toContainText("Видео загружено");
  });
});
