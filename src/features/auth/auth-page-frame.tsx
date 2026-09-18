import type { ReactNode } from "react";
import Link from "next/link";

type AuthPageFrameProps = {
  children: ReactNode;
  description: string;
  eyebrow: string;
  footer: ReactNode;
  title: string;
};

export function AuthPageFrame({
  children,
  description,
  eyebrow,
  footer,
  title,
}: AuthPageFrameProps) {
  return (
    <main className="auth-page auth-page--product">
      <header className="auth-page__header">
        <Link className="auth-page__brand" href="/" aria-label="Псих Фактчек — главная">
          <span aria-hidden="true">ПФ</span>
          Псих Фактчек
        </Link>
        <Link className="auth-page__help" href="/#about">Как это работает</Link>
      </header>
      <section className="auth-page__content" aria-labelledby="auth-title">
        <div className="auth-page__introduction">
          <p className="auth-page__eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
          <p className="auth-page__statement" aria-hidden="true">
            Проверяйте утверждения.<br />
            Сохраняйте контекст.
          </p>
        </div>
        <div className="auth-page__form-surface">
          <div className="auth-page__form-heading">
            <span aria-hidden="true">01</span>
            <p>Доступ к рабочему пространству</p>
          </div>
          {children}
          <div className="auth-page__footer">{footer}</div>
        </div>
      </section>
    </main>
  );
}
