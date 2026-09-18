import { expect, test } from "@playwright/test";

const authEnvironmentIsConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const loginEnvironmentIsConfigured = Boolean(
  authEnvironmentIsConfigured &&
    process.env.E2E_SUPABASE_EMAIL &&
    process.env.E2E_SUPABASE_PASSWORD,
);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(process.env.E2E_SUPABASE_EMAIL!);
  await page.getByLabel("Пароль").fill(process.env.E2E_SUPABASE_PASSWORD!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("opens the signup preview from the home page", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/Psych Factcheck/);
  await expect(page).toHaveURL(/\/ui-preview\/auth\?mode=signup/);
  await expect(
    page.getByRole("heading", { name: "Создайте аккаунт" }),
  ).toBeVisible();
});

test("keeps only the authentication and checks previews", async ({ page }) => {
  await page.goto("/ui-preview/history");
  await expect(page.getByRole("heading", { name: "Все проверки" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Проверки", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("navigates through the authentication preview", async ({ page }) => {
  await page.goto("/ui-preview/auth");
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await expect(page).toHaveURL(/\/ui-preview\/auth\?mode=signup/);
  await expect(page.getByRole("heading", { name: "Создайте аккаунт" })).toBeVisible();
  await page.getByRole("tab", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/ui-preview\/auth$/);
  await page.getByRole("link", { name: "Забыли пароль?" }).click();
  await expect(page).toHaveURL(/\/ui-preview\/auth\?mode=reset/);
  await expect(page.getByRole("heading", { name: "Восстановить пароль" })).toBeVisible();
});

test.describe("authentication", () => {
  test.skip(
    !authEnvironmentIsConfigured,
    "Requires a local Supabase Auth environment configured for E2E.",
  );

  test("redirects an unauthenticated visitor away from the dashboard", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(
      page.getByRole("heading", { name: "Войдите в аккаунт" }),
    ).toBeVisible();
  });

  test("allows a new user to sign up", async ({ page }) => {
    const email = `e2e-${crypto.randomUUID()}@example.test`;

    await page.goto("/signup");
    await page.getByLabel("Эл. почта").fill(email);
    await page.getByLabel("Пароль").fill("e2e-auth-password");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    await expect(
      page
        .getByRole("heading", { name: "Вы вошли в систему." })
        .or(
          page.getByText(
            "Проверьте почту, чтобы подтвердить регистрацию и войти.",
          ),
        ),
    ).toBeVisible();
  });

  test("allows an existing user to log in", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires credentials for a confirmed local Supabase test user.",
    );

    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Вы вошли в систему." }),
    ).toBeVisible();
  });

  test("ends the session on logout", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires credentials for a confirmed local Supabase test user.",
    );

    await signIn(page);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/login\?logout=success/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("uploads one valid video and shows completion", async ({ page }) => {
    test.skip(
      !loginEnvironmentIsConfigured,
      "Requires credentials and a local Supabase Storage environment.",
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
