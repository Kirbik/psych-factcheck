import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { signIn } from "@/features/auth/actions";
import { AuthPageFrame } from "@/features/auth/auth-page-frame";

type LoginPageProps = {
  searchParams: Promise<{ logout?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { logout } = await searchParams;
  const notice =
    logout === "success"
      ? "Вы вышли из системы."
      : logout === "failed"
        ? "Не удалось завершить сеанс. Попробуйте ещё раз."
        : undefined;

  return (
    <AuthPageFrame
      eyebrow="С возвращением"
      title="Войдите в аккаунт"
      description="Продолжайте работу с проверками и возвращайтесь к сохранённым отчётам."
      footer={
        <p>
          Нет аккаунта? <Link href="/signup">Зарегистрироваться</Link>
        </p>
      }
    >
        {notice ? <p role="status">{notice}</p> : null}
        <AuthForm action={signIn} submitLabel="Войти" />
    </AuthPageFrame>
  );
}
