import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoutButton } from "@/features/auth/logout-button";
import { createServerAuthClient } from "@/server/supabase/auth";
import { AppHeader } from "@/components/layout/app-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { VideoUploadForm } from "@/features/analysis/video-upload-form";

function emailFromClaims(claims: Record<string, unknown> | undefined) {
  return typeof claims?.email === "string" ? claims.email : undefined;
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

  const email = emailFromClaims(claims);

  return (
    <>
      <AppHeader current="checks" />
      <main className="page dashboard-page">
        <PageHeader title="Ваши проверки" description="Здесь появятся ваши текущие и завершённые проверки." />
        <Container>
          <Card className="dashboard-upload" aria-labelledby="video-upload-title">
            <h2 id="video-upload-title">Новая проверка</h2>
            <VideoUploadForm />
          </Card>
          <Card className="dashboard-welcome" aria-labelledby="dashboard-title">
            <div className="dashboard-welcome__icon" aria-hidden="true">⌁</div>
            <div>
              <h2 id="dashboard-title">Вы вошли в систему.</h2>
              <p>{email ? `Аккаунт: ${email}` : "Ваш аккаунт готов к первой проверке."}</p>
              <p className="muted-text">Здесь будут отображаться сохранённые проверки.</p>
            </div>
            <LogoutButton />
          </Card>
        </Container>
      </main>
    </>
  );
}
