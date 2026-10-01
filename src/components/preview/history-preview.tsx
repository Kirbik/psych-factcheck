"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter, Lora } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
import styles from "./history-preview.module.css";
import extraStyles from "./history-preview-extra.module.css";
import menuStyles from "./history-preview-menu.module.css";
import { FirstLoginSecretsModal } from "./first-login-secrets-modal";
import type {
  HistoryCheck,
  HistoryLoadResult,
  HistoryCheckStatus,
} from "@/features/history/history-contract";

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

type Filter = "all" | HistoryCheckStatus;

const PAGE_SIZE = 6;
const EMPTY_CHECKS: readonly HistoryCheck[] = [];

const filterLabels: Record<Filter, string> = {
  all: "Все",
  processing: "Выполняются",
  completed: "Готово",
  failed: "Не удалось завершить",
};
const statusLabels: Record<HistoryCheckStatus, string> = {
  completed: "Готово",
  processing: "Выполняется",
  failed: "Не удалось завершить",
};

function StatusIcon({ status }: { status: HistoryCheckStatus }) {
  if (status === "completed")
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m5 12 4 4 10-10" />
      </svg>
    );
  if (status === "failed")
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m8 8 8 8M16 8l-8 8" />
      </svg>
    );
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" strokeDasharray="2 4" />
    </svg>
  );
}

function StatusBadge({ status }: { status: HistoryCheckStatus }) {
  return (
    <span className={`${styles.status} ${styles[`status-${status}`]}`}>
      <StatusIcon status={status} />
      {statusLabels[status]}
    </span>
  );
}

export function HistoryPreview({ result }: { result: HistoryLoadResult }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rows: readonly HistoryCheck[] =
    result.kind === "ready" ? result.checks : EMPTY_CHECKS;
  const filteredRows = useMemo(
    () =>
      filter === "all" ? rows : rows.filter((row) => row.status === filter),
    [filter, rows],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page],
  );

  useEffect(() => {
    const closeMenuOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest("button[aria-haspopup='menu'], [role='menu']")
      )
        setOpenMenu(null);
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeMenuOnOutsidePointer);
  }, []);

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <FirstLoginSecretsModal />
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Псих Фактчек — проверки"
        >
          <span className={styles.mark}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.2" />
              <path d="m8.4 12.1 2.2 2.2 4.9-5" />
            </svg>
          </span>
          Псих Фактчек
        </Link>
        <nav className={styles.nav} aria-label="Навигация приложения">
          <Link
            className={styles.navActive}
            href="/history"
            aria-current="page"
          >
            Проверки
          </Link>
          <Link href="/profile">Профиль</Link>
        </nav>
      </header>
      <section className={styles.content} aria-labelledby="history-title">
        <div className={extraStyles.headingRow}>
          <div className={styles.heading}>
            <h1 id="history-title">Все проверки</h1>
            <p>Ваши завершённые и текущие проверки.</p>
          </div>
          <button
            className={`${styles.newCheck} ${extraStyles.newCheck}`}
            onClick={() => router.push("/new-check")}
            type="button"
          >
            + Новая проверка
          </button>
        </div>
        <div
          className={styles.filters}
          role="tablist"
          aria-label="Фильтр проверок"
        >
          {(Object.keys(filterLabels) as Filter[]).map((item) => (
            <button
              aria-selected={filter === item}
              className={filter === item ? styles.filterActive : styles.filter}
              key={item}
              onClick={() => {
                setFilter(item);
                setPage(1);
              }}
              role="tab"
              type="button"
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              Все проверки пользователя
            </caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Статус</th>
                <th scope="col">Утверждения</th>
                <th scope="col">Дата</th>
                <th scope="col">
                  <span className={styles.srOnly}>Дополнительные действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  aria-label={`Открыть проверку: ${row.title}`}
                  key={row.id}
                  onClick={(event) => {
                    if (
                      event.target instanceof Element &&
                      event.target.closest("a,button")
                    )
                      return;
                    router.push(row.href);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      event.target === event.currentTarget
                    ) {
                      event.preventDefault();
                      router.push(row.href);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <th data-label="Название" scope="row">
                    {row.title}
                  </th>
                  <td data-label="Статус">
                    <StatusBadge status={row.status} />
                  </td>
                  <td data-label="Утверждения">{row.claims}</td>
                  <td data-label="Дата" className={styles.date}>
                    {row.date}
                  </td>
                  <td className={`${styles.menuCell} ${menuStyles.menuCell}`}>
                    <button
                      aria-expanded={openMenu === row.id}
                      aria-haspopup="menu"
                      aria-label={`Дополнительные действия: ${row.title}`}
                      className={styles.menu}
                      onClick={() =>
                        setOpenMenu(openMenu === row.id ? null : row.id)
                      }
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </button>
                    {openMenu === row.id ? (
                      <div
                        className={menuStyles.menuPopup}
                        role="menu"
                        aria-label={`Действия: ${row.title}`}
                      >
                        <Link
                          className={menuStyles.menuItem}
                          href={row.href}
                          onClick={() => setOpenMenu(null)}
                          role="menuitem"
                        >
                          Просмотреть
                        </Link>
                        <button
                          className={`${menuStyles.menuItem} ${menuStyles.menuDanger}`}
                          onClick={() => setOpenMenu(null)}
                          role="menuitem"
                          type="button"
                        >
                          Удалить
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.kind === "unavailable" ? (
            <p className={styles.empty} role="status">
              Не удалось загрузить список проверок.
            </p>
          ) : visibleRows.length === 0 ? (
            <p className={styles.empty}>Для этого фильтра проверок пока нет.</p>
          ) : null}
        </div>
        <div className={styles.pagination}>
          <span>
            Показаны{" "}
            {filteredRows.length === 0
              ? "0"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filteredRows.length)}`}{" "}
            из {filteredRows.length}
          </span>
          <div>
            <button
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Назад
            </button>
            <button
              disabled={page >= pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              type="button"
            >
              Вперёд
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
