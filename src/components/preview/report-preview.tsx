"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useState, type KeyboardEvent } from "react";
import styles from "./history-preview.module.css";
import reportStyles from "./report-preview.module.css";
import type {
  ReportClaim,
  ReportClaimStatus,
  ReportLoadResult,
  ReportSource,
} from "@/features/report/report-contract";

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

const statusOrder: readonly ReportClaimStatus[] = [
  "contradicted",
  "disputed",
  "not-found",
  "supported",
];
const statusLabels: Record<ReportClaimStatus, string> = {
  contradicted: "Расходится с данными",
  disputed: "Спорное утверждение",
  "not-found": "Данные не найдены",
  supported: "Данные подтверждены",
};
const sourceTypeLabels: Record<string, string> = {
  systematic_review: "Систематический обзор",
  meta_analysis: "Метаанализ",
  journal_article: "Научная статья",
  commentary: "Научный комментарий",
};

function formatDate(value: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
}

function formatYear(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatTiming(claim: ReportClaim): string {
  const start = formatTime(claim.startSeconds);
  const end = formatTime(claim.endSeconds);
  return start.startsWith("00:") && end.startsWith("00:")
    ? `${start.slice(3)}–${end.slice(3)}`
    : `${start}–${end}`;
}

function getSourceCount(claims: readonly ReportClaim[]): number {
  return new Set(
    claims.flatMap((claim) => claim.sources.map((source) => source.id)),
  ).size;
}

function formatSourceType(source: ReportSource): string {
  return sourceTypeLabels[source.sourceType] ?? "Источник";
}

function ReportHeader() {
  return (
    <header className={styles.header}>
      <Link
        className={styles.brand}
        href="/"
        aria-label="Псих Фактчек — проверки"
      >
        <span className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.2" />
            <path d="m8.4 12.1 2.2 2.2 4.9-5" />
          </svg>
        </span>
        Псих Фактчек
      </Link>
      <nav className={styles.nav} aria-label="Навигация приложения">
        <Link className={styles.navActive} href="/history" aria-current="page">
          Проверки
        </Link>
        <Link href="/profile">Профиль</Link>
      </nav>
    </header>
  );
}

function EmptyReport({
  result,
}: {
  result: Exclude<ReportLoadResult, { kind: "ready" }>;
}) {
  const title =
    result.kind === "processing"
      ? "Проверка еще выполняется"
      : result.kind === "out_of_scope"
        ? "Отчет не сформирован"
        : result.kind === "failed"
          ? "Проверка не завершена"
          : result.kind === "unavailable"
            ? "Не удалось загрузить данные отчета"
            : result.kind === "localization_unavailable"
              ? "Не удалось подготовить отчет на русском языке"
              : "Отчет пока не выбран";
  const description =
    result.kind === "processing"
      ? "Отчет появится после завершения всех этапов обработки видео."
      : result.kind === "out_of_scope"
        ? "Видео не прошло первичную проверку, поэтому полная проверка утверждений не проводилась."
        : result.kind === "failed"
          ? "Завершенные этапы сохранены. Вернитесь к обработке, чтобы повторить запуск."
          : result.kind === "unavailable"
            ? "Сохраненные данные проверки неполны. Попробуйте открыть отчет позже."
            : result.kind === "localization_unavailable"
              ? "Перевод текста проверки временно недоступен. Попробуйте открыть отчет позже."
              : "Откройте отчет завершенной проверки из списка проверок.";

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <ReportHeader />
      <section
        className={`${styles.content} ${reportStyles.content}`}
        aria-labelledby="report-title"
      >
        <Link className={reportStyles.back} href="/history">
          ← Все проверки
        </Link>
        <h1 className={reportStyles.title} id="report-title">
          {title}
        </h1>
        <p className={reportStyles.emptyDescription}>{description}</p>
        {"contentItemId" in result ? (
          <Link
            className={reportStyles.stateLink}
            href={`/processing?contentItemId=${encodeURIComponent(result.contentItemId)}`}
          >
            Открыть обработку
          </Link>
        ) : null}
      </section>
    </main>
  );
}

function ReportReady({
  report,
}: {
  report: Extract<ReportLoadResult, { kind: "ready" }>["report"];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const counts = statusOrder.map((status) => ({
    status,
    count: report.claims.filter((claim) => claim.status === status).length,
  }));
  const activeClaim = report.claims[activeIndex];
  const sourceCount = getSourceCount(report.claims);

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      nextIndex = (index + 1) % report.claims.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      nextIndex = (index - 1 + report.claims.length) % report.claims.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = report.claims.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    document.getElementById(`report-claim-tab-${nextIndex}`)?.focus();
  }

  return (
    <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
      <ReportHeader />
      <section
        className={`${styles.content} ${reportStyles.content}`}
        aria-labelledby="report-title"
      >
        <div className={reportStyles.headingRow}>
          <div>
            <Link className={reportStyles.back} href="/history">
              ← Все проверки
            </Link>
            <h1 className={reportStyles.title} id="report-title">
              Отчет: {report.fileName}
            </h1>
          </div>
          <p className={reportStyles.checkedAt}>
            Проверка завершена {formatDate(report.checkedAt)}
          </p>
        </div>

        <div className={reportStyles.meta}>
          <div>
            <b>Дата проверки</b>
            {formatDate(report.checkedAt)}
          </div>
          <div>
            <b>Источник видео</b>Видеофайл
          </div>
          <div>
            <b>Утверждения</b>
            {report.claims.length}
          </div>
          <div>
            <b>Источники</b>
            {sourceCount}
          </div>
        </div>

        <div
          className={reportStyles.chart}
          role="img"
          aria-label={`Распределение по статусам утверждений: ${counts.map(({ status, count }) => `${statusLabels[status]} — ${count}`).join(", ")}`}
        >
          {counts
            .filter(({ count }) => count > 0)
            .map(({ status, count }) => (
              <span
                className={`${reportStyles.segment} ${reportStyles[`segment-${status}`]}`}
                key={status}
                style={{ flexGrow: count }}
                title={`${statusLabels[status]}: ${count}`}
              />
            ))}
        </div>
        <div className={reportStyles.legend} aria-label="Статусы утверждений">
          {counts.map(({ status, count }) => (
            <span key={status}>
              <i
                className={`${reportStyles.dot} ${reportStyles[`segment-${status}`]}`}
                aria-hidden="true"
              />
              {statusLabels[status]} <b>{count}</b>
            </span>
          ))}
        </div>

        {activeClaim ? (
          <div className={reportStyles.reportLayout}>
            <aside
              className={reportStyles.claimList}
              aria-label="Список утверждений"
            >
              <h2>Утверждения</h2>
              <div
                role="tablist"
                aria-label="Утверждения"
                aria-orientation="vertical"
              >
                {report.claims.map((claim, index) => (
                  <button
                    aria-controls="report-claim-panel"
                    aria-selected={index === activeIndex}
                    className={
                      index === activeIndex
                        ? reportStyles.claimTabActive
                        : reportStyles.claimTab
                    }
                    id={`report-claim-tab-${index}`}
                    key={claim.id}
                    onClick={() => setActiveIndex(index)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    role="tab"
                    tabIndex={index === activeIndex ? 0 : -1}
                    type="button"
                  >
                    <span className={reportStyles.claimNumber}>
                      {index + 1}.
                    </span>
                    <span className={reportStyles.claimSummary}>
                      <span>{claim.title}</span>
                      <span
                        className={`${reportStyles.status} ${reportStyles[`status-${claim.status}`]}`}
                      >
                        {statusLabels[claim.status]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <article
              aria-labelledby={`report-claim-tab-${activeIndex}`}
              className={reportStyles.claimPanel}
              id="report-claim-panel"
              role="tabpanel"
              tabIndex={0}
            >
              <ClaimDetail claim={activeClaim} />
            </article>
          </div>
        ) : (
          <p className={reportStyles.noClaims}>
            Проверка завершена. Проверяемых утверждений не найдено.
          </p>
        )}
      </section>
    </main>
  );
}

function ClaimDetail({ claim }: { claim: ReportClaim }) {
  return (
    <>
      <div className={reportStyles.claimHeading}>
        <h2>{claim.title}</h2>
      </div>
      <div className={reportStyles.detailGrid}>
        <div className={reportStyles.detailColumn}>
          <section className={reportStyles.detailBlock}>
            <h3>Оригинальная фраза из видео</h3>
            <p>{claim.originalText}</p>
          </section>
          <p className={reportStyles.timing}>
            <b>Произнесено:</b> {formatTiming(claim)}
          </p>
          <section className={reportStyles.detailBlock}>
            <h3>Проверяемая формулировка</h3>
            <p>{claim.normalizedText}</p>
          </section>
        </div>
        <section
          className={reportStyles.conclusion}
          aria-label="Заключение по утверждению"
        >
          <h3>Вывод</h3>
          <span
            className={`${reportStyles.status} ${reportStyles[`status-${claim.status}`]}`}
          >
            {statusLabels[claim.status]}
          </span>
          <p className={reportStyles.confidence}>
            Оценка уверенности модели: {Math.round(claim.confidence * 100)}%
          </p>
          <h3>Почему сделан такой вывод</h3>
          <p className={reportStyles.explanation}>{claim.explanation}</p>
        </section>
      </div>
      <section
        className={reportStyles.sources}
        aria-labelledby="report-sources-title"
      >
        <h3 id="report-sources-title">
          Использованные источники ({claim.sources.length})
        </h3>
        {claim.sources.length ? (
          <div className={reportStyles.sourceGrid}>
            {claim.sources.map((source) => (
              <article className={reportStyles.source} key={source.id}>
                <span>
                  {formatSourceType(source)} · {formatYear(source.publishedAt)}
                </span>
                <h4>{source.title}</h4>
                <p>{source.authors.join(", ")}</p>
                <p>
                  {[source.journal, source.publisher]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {source.url ? (
                  <a href={source.url} rel="noreferrer" target="_blank">
                    Открыть источник
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className={reportStyles.muted}>Цитируемые источники не указаны.</p>
        )}
      </section>
    </>
  );
}

export function ReportPreview({ result }: { result: ReportLoadResult }) {
  if (result.kind !== "ready") return <EmptyReport result={result} />;
  return <ReportReady report={result.report} />;
}
