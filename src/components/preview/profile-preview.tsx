import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import styles from "./history-preview.module.css";
import profileStyles from "./profile-preview.module.css";

const inter = Inter({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--history-preview-inter",
  weight: ["400", "500", "600"],
});

const lora = Lora({
  display: "swap",
  subsets: ["cyrillic", "latin"],
  variable: "--history-preview-lora",
  weight: ["600"],
});

export function ProfilePreview() {
  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <header className={styles.header}>
        <Link
          aria-label="Псих Фактчек — проверки"
          className={styles.brand}
          href="/"
        >
          <span className={styles.mark}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.2" />
              <path d="m8.4 12.1 2.2 2.2 4.9-5" />
            </svg>
          </span>
          Псих Фактчек
        </Link>
        <nav aria-label="Навигация приложения" className={styles.nav}>
          <Link href="/ui-preview/history">Проверки</Link>
          <Link
            aria-current="page"
            className={styles.navActive}
            href="/ui-preview/profile"
          >
            Профиль
          </Link>
        </nav>
      </header>
      <section
        aria-labelledby="profile-title"
        className={`${styles.content} ${profileStyles.content}`}
      >
        <h1 className={profileStyles.title} id="profile-title">
          Профиль
        </h1>
        <div className={profileStyles.card}>
          <button className={profileStyles.logoutButton} type="button">
            Выйти
          </button>
        </div>
      </section>
    </main>
  );
}
