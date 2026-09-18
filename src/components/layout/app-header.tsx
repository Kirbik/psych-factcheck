import Link from "next/link";

type AppHeaderProps = {
  current?: "checks" | "home";
};

export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="app-header">
      <Link className="app-header__brand" href="/" aria-label="Псих Фактчек — главная">
        <span className="app-header__mark" aria-hidden="true">ψ</span>
        <span>Псих Фактчек</span>
      </Link>
      <nav aria-label="Основная навигация" className="app-header__nav">
        <Link aria-current={current === "checks" ? "page" : undefined} href="/dashboard">Проверки</Link>
        <Link aria-current={current === "home" ? "page" : undefined} href="/#about">О проекте</Link>
      </nav>
    </header>
  );
}
