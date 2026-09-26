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
  await expect(page).toHaveURL(/\/ui-preview\/history/);
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
  await page.goto("/ui-preview/history");
  await expect(
    page.getByRole("heading", { name: "Все проверки" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Проверки", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("keeps codeword and token values separate across tabs and clears them on reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Токен авторизации").fill(`pfc_${"a".repeat(64)}`);
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await expect(page).toHaveURL(/\/?mode=signup$/);
  await expect(
    page.getByRole("heading", { name: "Создайте аккаунт" }),
  ).toBeVisible();
  await expect(page.getByLabel("Кодовое слово")).toHaveValue("");
  await page.getByLabel("Кодовое слово").fill("some secret word");

  await page.getByRole("tab", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Токен авторизации")).toHaveValue(
    `pfc_${"a".repeat(64)}`,
  );
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await expect(page.getByLabel("Кодовое слово")).toHaveValue(
    "some secret word",
  );

  await page.reload();
  await expect(page.getByLabel("Кодовое слово")).toHaveValue("");
  await page.goto("/");
  await expect(page.getByLabel("Токен авторизации")).toHaveValue("");
  await page.goto("/?mode=reset");
  await expect(
    page.getByRole("heading", { name: "Восстановление доступа" }),
  ).toBeVisible();
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
    await page.getByLabel("Кодовое слово").fill("e2e-secret-word");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();
    await expect(page.getByLabel("Токен авторизации")).toHaveValue(
      /^pfc_[a-f0-9]{64}$/,
    );
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

  test("ends the session on logout", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires a valid E2E_SUPABASE_TOKEN for a confirmed test user.",
    );

    await signIn(page);
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
    await page.setInputFiles("#video-upload-file", {
      name: "e2e-video.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
    });
    await page.getByRole("button", { name: "Загрузить видео" }).click();
    await expect(page.getByRole("status")).toContainText("Видео загружено");
  });
});
