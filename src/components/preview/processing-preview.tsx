"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useEffect, useState } from "react";
import styles from "./history-preview.module.css";
import processingStyles from "./processing-preview.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

type StepStatus = "completed" | "processing" | "pending" | "failed";

type ProcessingStep = { label: string; status: StepStatus };

// Preview data mirrors the shape expected from a future processing API response.
const backendSteps: ProcessingStep[] = [
  { label: "Загрузить видео", status: "completed" },
  { label: "Создание транскрипта", status: "processing" },
  { label: "Выделение утверждений", status: "pending" },
  { label: "Поиск научных источников", status: "pending" },
  { label: "Сопоставление данных", status: "pending" },
  { label: "Подготовка отчета", status: "pending" },
];

const statusLabels: Record<StepStatus, string> = { completed: "Готово", processing: "Выполняется", pending: "Ожидает", failed: "Ошибка" };

export function ProcessingPreview() {
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(backendSteps.map((step) => step.status));
  const isComplete = stepStatuses.every((status) => status === "completed");

  useEffect(() => {
    if (isComplete) return;
    const timer = window.setInterval(() => {
      setStepStatuses((current) => {
        const next = [...current];
        const activeIndex = next.findIndex((status) => status === "processing");
        if (activeIndex === -1) return next;
        next[activeIndex] = "completed";
        const nextIndex = activeIndex + 1;
        if (nextIndex < next.length) next[nextIndex] = "processing";
        return next;
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [isComplete]);

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link>
      <nav className={styles.nav} aria-label="Навигация приложения"><Link className={styles.navActive} href="/ui-preview/history" aria-current="page">Проверки</Link><Link href="/ui-preview/profile">Профиль</Link></nav>
    </header>
    <section className={`${styles.content} ${processingStyles.content}`} aria-labelledby="processing-title">
      <Link className={processingStyles.back} href="/ui-preview/new-check"><span aria-hidden="true">←</span> Новая проверка</Link>
      <h1 className={processingStyles.title} id="processing-title">Проверяем видео</h1>
      <p className={processingStyles.subtitle}>Эту страницу можно закрыть: проверка продолжится автоматически</p>
      <div className={processingStyles.card}>
      <ol className={processingStyles.steps} aria-label="Прогресс проверки видео">
        {backendSteps.map((step, index) => { const status = stepStatuses[index]; return <li className={`${processingStyles.step} ${processingStyles[`step-${status}`]}`} key={step.label}><span className={processingStyles.indicator} aria-hidden="true">{status === "completed" ? "✓" : status === "failed" ? "×" : ""}</span><span className={processingStyles.stepLabel}>{step.label}</span><span className={processingStyles.stepStatus}>{statusLabels[status]}</span></li>; })}
      </ol>
      <Link className={`${processingStyles.reportButton} ${!isComplete ? processingStyles.disabled : ""}`} aria-disabled={!isComplete} href={isComplete ? "/ui-preview/report" : "#processing-title"} onClick={(event) => { if (!isComplete) event.preventDefault(); }}>Перейти к отчету</Link>
      </div>
    </section>
  </main>;
}
