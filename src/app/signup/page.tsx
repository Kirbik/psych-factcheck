import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { signUp } from "@/features/auth/actions";
import { AuthPageFrame } from "@/features/auth/auth-page-frame";

export default function SignUpPage() {
  return (
    <AuthPageFrame
      eyebrow="Новый аккаунт"
      title="Создайте аккаунт"
      description="Сохраняйте приватные проверки и возвращайтесь к отчётам в любое время."
      footer={
        <p>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      }
    >
        <AuthForm action={signUp} submitLabel="Зарегистрироваться" />
    </AuthPageFrame>
  );
}
