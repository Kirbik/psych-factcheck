import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoutButton } from "@/features/auth/logout-button";
import { createServerAuthClient } from "@/server/supabase/auth";
import { AppHeader } from "@/components/layout/app-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { VideoUploadForm } from "@/features/analysis/video-upload-form";
import { contentItemsRepository } from "@/server/db/content-items-repository";
import type { Database } from "@/types/database";

type ContentItemStatus = Database["public"]["Enums"]["content_item_status"];

const contentItemStatusLabels: Record<ContentItemStatus, string> = {
  pending: "В обработке",
  ready: "Готово",
  failed: "Не удалось завершить",
};

function formatCheckDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  await connection();
  const supabase = await createServerAuthClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;

  // This is the authoritative check. The proxy is only an early redirect.
  if (error || typeof claims?.sub !== "string") {
    redirect("/login");
  }

  const { data: checks, error: checksError } = await contentItemsRepository
    .listOwned(supabase, claims.sub)
    .order("created_at", { ascending: false });

  return (
    <>
      <AppHeader current="checks" />
      <main className="page dashboard-page">
        <PageHeader
          title="Ваши проверки"
          description="Здесь появятся ваши текущие и завершённые проверки."
        />
        <Container>
          <Card className="dashboard-history" aria-labelledby="checks-title">
            <h2 id="checks-title">Список проверок</h2>
            {checksError ? (
              <p role="status">Не удалось загрузить список проверок</p>
            ) : checks.length === 0 ? (
              <p className="muted-text">У вас пока нет сохранённых проверок.</p>
            ) : (
              <ul className="dashboard-history__list">
                {checks.map((check) => (
                  <li className="dashboard-history__item" key={check.id}>
                    <div>
                      <strong>
                        {check.original_file_name ?? "Проверка видео"}
                      </strong>
                      <span>{formatCheckDate(check.created_at)}</span>
                    </div>
                    <span className="dashboard-history__status">
                      {contentItemStatusLabels[check.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card
            className="dashboard-upload"
            aria-labelledby="video-upload-title"
          >
            <h2 id="video-upload-title">Новая проверка</h2>
            <VideoUploadForm />
          </Card>
          <Card className="dashboard-welcome" aria-labelledby="dashboard-title">
            <div className="dashboard-welcome__icon" aria-hidden="true">
              ⌁
            </div>
            <div>
              <h2 id="dashboard-title">Вы вошли в систему.</h2>
              <p>Ваш аккаунт готов к первой проверке.</p>
              <p className="muted-text">
                Здесь будут отображаться сохранённые проверки.
              </p>
            </div>
            <LogoutButton />
          </Card>
        </Container>
      </main>
    </>
  );
}
