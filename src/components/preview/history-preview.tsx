"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter, Lora } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
import styles from "./history-preview.module.css";
import extraStyles from "./history-preview-extra.module.css";
import menuStyles from "./history-preview-menu.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

type CheckStatus = "completed" | "processing" | "failed";
type Filter = "all" | CheckStatus;

const rows: Array<{ title: string; status: CheckStatus; claims: string; date: string; action: string; href: string }> = [
  { title: "Влияет ли кофе на уровень тревожности?", status: "completed", claims: "8 из 8", date: "12 мая 2025, 14:32", action: "Открыть отчёт", href: "#check-1" },
  { title: "Правда ли, что гаджеты ухудшают сон?", status: "processing", claims: "3 из 7", date: "11 мая 2025, 10:15", action: "Открыть статус", href: "#check-2" },
  { title: "Эффективна ли медитация при депрессии?", status: "completed", claims: "6 из 6", date: "9 мая 2025, 18:40", action: "Открыть отчёт", href: "#check-3" },
  { title: "Вызывает ли сахар перепады настроения?", status: "failed", claims: "2 из 5", date: "7 мая 2025, 11:03", action: "Посмотреть детали", href: "#check-4" },
  { title: "Помогает ли физическая активность при стрессе?", status: "completed", claims: "10 из 10", date: "5 мая 2025, 16:21", action: "Открыть отчёт", href: "#check-5" },
  { title: "Связаны ли социальные сети со снижением самооценки?", status: "processing", claims: "4 из 9", date: "3 мая 2025, 09:12", action: "Открыть статус", href: "#check-6" },
  { title: "Влияет ли режим сна на концентрацию?", status: "completed", claims: "7 из 7", date: "1 мая 2025, 13:20", action: "Открыть отчёт", href: "#check-7" },
  { title: "Помогает ли дыхательная гимнастика снизить стресс?", status: "completed", claims: "5 из 5", date: "29 апреля 2025, 16:05", action: "Открыть отчёт", href: "#check-8" },
  { title: "Связано ли чтение с улучшением памяти?", status: "processing", claims: "2 из 6", date: "27 апреля 2025, 09:48", action: "Открыть статус", href: "#check-9" },
  { title: "Влияет ли музыка на продуктивность?", status: "failed", claims: "1 из 4", date: "25 апреля 2025, 12:11", action: "Посмотреть детали", href: "#check-10" },
  { title: "Эффективны ли короткие перерывы в работе?", status: "completed", claims: "9 из 9", date: "22 апреля 2025, 17:36", action: "Открыть отчёт", href: "#check-11" },
  { title: "Улучшает ли дневник настроение?", status: "completed", claims: "6 из 6", date: "20 апреля 2025, 10:22", action: "Открыть отчёт", href: "#check-12" },
  { title: "Влияет ли прогулка на качество сна?", status: "processing", claims: "3 из 8", date: "18 апреля 2025, 14:50", action: "Открыть статус", href: "#check-13" },
  { title: "Помогает ли планирование справляться с тревогой?", status: "completed", claims: "8 из 8", date: "15 апреля 2025, 11:04", action: "Открыть отчёт", href: "#check-14" },
  { title: "Связано ли общение с близкими с уровнем стресса?", status: "failed", claims: "2 из 7", date: "12 апреля 2025, 18:17", action: "Посмотреть детали", href: "#check-15" },
  { title: "Влияют ли рабочие привычки на выгорание?", status: "completed", claims: "10 из 10", date: "9 апреля 2025, 15:42", action: "Открыть отчёт", href: "#check-16" },
  { title: "Помогает ли физическая активность улучшить сон?", status: "processing", claims: "4 из 9", date: "6 апреля 2025, 08:35", action: "Открыть статус", href: "#check-17" },
  { title: "Влияет ли общение в интернете на самооценку?", status: "completed", claims: "6 из 6", date: "3 апреля 2025, 19:08", action: "Открыть отчёт", href: "#check-18" },
];

const PAGE_SIZE = 6;

const filterLabels: Record<Filter, string> = { all: "Все", processing: "Выполняются", completed: "Готово", failed: "Не удалось завершить" };
const statusLabels: Record<CheckStatus, string> = { completed: "Готово", processing: "Выполняется", failed: "Не удалось завершить" };

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "completed") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" /></svg>;
  if (status === "failed") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 8 8 8M16 8l-8 8" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" strokeDasharray="2 4" /></svg>;
}

function StatusBadge({ status }: { status: CheckStatus }) {
  return <span className={`${styles.status} ${styles[`status-${status}`]}`}><StatusIcon status={status} />{statusLabels[status]}</span>;
}

export function HistoryPreview() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const filteredRows = useMemo(() => filter === "all" ? rows : rows.filter((row) => row.status === filter), [filter]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredRows, page]);

  useEffect(() => {
    const closeMenuOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest("button[aria-haspopup='menu'], [role='menu']")) setOpenMenu(null);
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsidePointer);
  }, []);

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link>
      <nav className={styles.nav} aria-label="Навигация приложения"><Link className={styles.navActive} href="/ui-preview/history" aria-current="page">Проверки</Link><Link href="/ui-preview/profile">Профиль</Link></nav>
    </header>
    <section className={styles.content} aria-labelledby="history-title">
      <div className={extraStyles.headingRow}>
        <div className={styles.heading}><h1 id="history-title">Все проверки</h1><p>Ваши завершённые и текущие проверки.</p></div>
        <button className={`${styles.newCheck} ${extraStyles.newCheck}`} onClick={() => router.push("/ui-preview/new-check")} type="button">+ Новая проверка</button>
      </div>
      <div className={styles.filters} role="tablist" aria-label="Фильтр проверок">{(Object.keys(filterLabels) as Filter[]).map((item) => <button aria-selected={filter === item} className={filter === item ? styles.filterActive : styles.filter} key={item} onClick={() => { setFilter(item); setPage(1); }} role="tab" type="button">{filterLabels[item]}</button>)}</div>
      <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Все проверки пользователя</caption><thead><tr><th scope="col">Название</th><th scope="col">Статус</th><th scope="col">Утверждения</th><th scope="col">Дата</th><th scope="col"><span className={styles.srOnly}>Дополнительные действия</span></th></tr></thead><tbody>{visibleRows.map((row) => <tr aria-label={`Открыть проверку: ${row.title}`} id={row.href.slice(1)} key={row.title} onClick={(event) => { if (event.target instanceof Element && event.target.closest("a,button")) return; window.location.href = "/ui-preview/report"; }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); window.location.href = "/ui-preview/report"; } }} role="link" tabIndex={0}><th data-label="Название" scope="row">{row.title}</th><td data-label="Статус"><StatusBadge status={row.status} /></td><td data-label="Утверждения">{row.claims}</td><td data-label="Дата" className={styles.date}>{row.date}</td><td className={`${styles.menuCell} ${menuStyles.menuCell}`}><button aria-expanded={openMenu === row.title} aria-haspopup="menu" aria-label={`Дополнительные действия: ${row.title}`} className={styles.menu} onClick={() => setOpenMenu(openMenu === row.title ? null : row.title)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg></button>{openMenu === row.title ? <div className={menuStyles.menuPopup} role="menu" aria-label={`Действия: ${row.title}`}><Link className={menuStyles.menuItem} href="/ui-preview/report" onClick={() => setOpenMenu(null)} role="menuitem">Просмотреть</Link><button className={`${menuStyles.menuItem} ${menuStyles.menuDanger}`} onClick={() => setOpenMenu(null)} role="menuitem" type="button">Удалить</button></div> : null}</td></tr>)}</tbody></table>{visibleRows.length === 0 ? <p className={styles.empty}>Для этого фильтра проверок пока нет.</p> : null}</div>
      <div className={styles.pagination}><span>Показаны {filteredRows.length === 0 ? "0" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filteredRows.length)}`} из {filteredRows.length}</span><div><button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Назад</button><button disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Вперёд</button></div></div>
    </section>
  </main>;
}
