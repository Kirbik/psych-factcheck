"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useState } from "react";
import styles from "./history-preview.module.css";
import reportStyles from "./report-preview.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

type ClaimStatus = "contradicted" | "disputed" | "not-found" | "supported";
type SourceType = "review" | "empirical" | "article";
type Claim = { title: string; status: ClaimStatus; original: string; formulation: string; timing: string; conclusion: string; sources: Array<{ type: SourceType; title: string; href: string }> };

const claims: Claim[] = [
  { title: "Кофе повышает уровень тревожности", status: "contradicted", original: "«Кофе всегда усиливает тревожность»", formulation: "Употребление кофе однозначно повышает тревожность у всех людей.", timing: "00:34–00:42", conclusion: "Доступные исследования не подтверждают универсальность этого утверждения: эффект зависит от дозы, индивидуальной чувствительности и привычки к кофеину.", sources: [{ type: "review", title: "Кофеин и тревожность: систематический обзор", href: "#source-1" }, { type: "article", title: "Индивидуальная реакция на кофеин", href: "#source-2" }] },
  { title: "Гаджеты ухудшают качество сна", status: "disputed", original: "«Телефон перед сном гарантированно портит сон»", formulation: "Использование экранов перед сном связано с ухудшением качества сна.", timing: "01:18–01:27", conclusion: "Связь наблюдается в ряде исследований, однако сила эффекта зависит от длительности использования, содержания и времени отхода ко сну.", sources: [{ type: "empirical", title: "Экранное время и сон взрослых", href: "#source-3" }] },
  { title: "Медитация помогает при стрессе", status: "supported", original: "«Медитация помогает снизить стресс»", formulation: "Регулярные практики медитации могут уменьшать субъективный стресс.", timing: "02:05–02:12", conclusion: "Результаты исследований в целом поддерживают умеренный положительный эффект регулярных практик осознанности на субъективный стресс.", sources: [{ type: "review", title: "Практики осознанности и стресс", href: "#source-4" }] },
  { title: "Универсального эффекта не найдено", status: "not-found", original: "«Эта привычка гарантированно улучшает настроение»", formulation: "Привычка гарантированно улучшает настроение у любого человека.", timing: "03:11–03:20", conclusion: "Надёжных научных данных, подтверждающих универсальный эффект для всех людей, не найдено.", sources: [] },
];

const statusLabels: Record<ClaimStatus, string> = { contradicted: "Расходится с данными", disputed: "Спорное утверждение", "not-found": "Данные не найдены", supported: "Данные подтверждены" };
const sourceLabels: Record<SourceType, string> = { review: "Систематический обзор", empirical: "Эмпирическое исследование", article: "Научная статья" };

export function ReportPreview() {
  const [activeClaim, setActiveClaim] = useState(0);
  const claim = claims[activeClaim];
  const orderedClaims = [...claims].sort((a, b) => ["contradicted", "disputed", "not-found", "supported"].indexOf(a.status) - ["contradicted", "disputed", "not-found", "supported"].indexOf(b.status));

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link><nav className={styles.nav} aria-label="Навигация приложения"><Link className={styles.navActive} href="/ui-preview/history" aria-current="page">Проверки</Link><Link href="/ui-preview/profile">Профиль</Link></nav></header>
    <section className={`${styles.content} ${reportStyles.content}`} aria-labelledby="report-title"><Link className={reportStyles.back} href="/ui-preview/history"><span aria-hidden="true">←</span> Все проверки</Link><h1 className={reportStyles.title} id="report-title">Отчет: влияние кофе на тревожность</h1><div className={reportStyles.meta}><span><b>Дата проверки</b>12 мая 2025, 14:32</span><span><b>Источник видео</b>Видеофайл</span><span><b>Утверждения</b>{claims.length}</span><span><b>Источники</b>{claims.reduce((total, item) => total + item.sources.length, 0)}</span></div><div className={reportStyles.chart} aria-label="Распределение статусов утверждений">{orderedClaims.map((item) => <span className={`${reportStyles.segment} ${reportStyles[`segment-${item.status}`]}`} key={item.title} title={statusLabels[item.status]} />)}</div><div className={reportStyles.legend}>{(["contradicted", "disputed", "not-found", "supported"] as ClaimStatus[]).map((status) => <span key={status}><i className={`${reportStyles.dot} ${reportStyles[`segment-${status}`]}`} />{statusLabels[status]}</span>)}</div><div className={reportStyles.claimTabs} role="tablist" aria-label="Утверждения">{claims.map((item, index) => <button className={index === activeClaim ? reportStyles.claimTabActive : reportStyles.claimTab} key={item.title} onClick={() => setActiveClaim(index)} role="tab" aria-selected={index === activeClaim} type="button">Утверждение {index + 1}</button>)}</div><article className={reportStyles.claim} role="tabpanel"><div className={reportStyles.claimHeading}><h2>{claim.title}</h2><span className={`${reportStyles.status} ${reportStyles[`status-${claim.status}`]}`}>{statusLabels[claim.status]}</span></div><div className={reportStyles.quoteGrid}><div><b>Оригинальная фраза из видео</b><p>{claim.original}</p></div><div><b>Проверяемая формулировка</b><p>{claim.formulation}</p></div></div><p className={reportStyles.timing}><b>Тайминг:</b> {claim.timing}</p><div className={reportStyles.conclusion}><b>Заключение</b><p>{claim.conclusion}</p></div><div className={reportStyles.sources}><h3>Источники</h3>{claim.sources.length ? claim.sources.map((source) => <div className={reportStyles.source} key={source.href}><span>{sourceLabels[source.type]}</span><Link href={source.href}>{source.title}</Link></div>) : <p className={reportStyles.muted}>Источники не найдены.</p>}</div></article></section>
  </main>;
}
