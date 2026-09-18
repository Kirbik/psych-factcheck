"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter, Lora } from "next/font/google";
import { useRef, useState } from "react";
import styles from "./history-preview.module.css";
import newStyles from "./new-check-preview.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

export function NewCheckPreview() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("video");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link>
      <nav className={styles.nav} aria-label="Навигация приложения"><Link className={styles.navActive} href="/ui-preview/history" aria-current="page">Проверки</Link><Link href="/ui-preview/profile">Профиль</Link></nav>
    </header>
    <section className={`${styles.content} ${newStyles.content}`} aria-labelledby="new-check-title">
      <Link className={newStyles.back} href="/ui-preview/history"><span aria-hidden="true">←</span> Все проверки</Link>
      <h1 className={newStyles.title} id="new-check-title">Новая проверка</h1>
      <div className={newStyles.tabs} role="tablist" aria-label="Тип проверки">
        <button className={activeTab === "video" ? newStyles.tabActive : newStyles.tab} onClick={() => setActiveTab("video")} role="tab" aria-selected={activeTab === "video"} type="button">Проверка видеофайла</button>
        <button className={newStyles.tab} disabled role="tab" aria-selected="false" type="button">Проверка рилса</button>
        <button className={newStyles.tab} disabled role="tab" aria-selected="false" type="button">Проверка аккаунта в инстаграмм</button>
      </div>
      {activeTab === "video" ? <form className={newStyles.card} onSubmit={(event) => { event.preventDefault(); if (videoFile) router.push("/ui-preview/processing"); }}>
        <div><h2>Загрузите видеофайл</h2><p className={newStyles.help}>Выберите видеофайл для проверки утверждений.</p></div>
        {videoFile ? <div className={newStyles.fileRow}><div className={newStyles.fileInfo}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5zM15 4v5h4" /></svg><div><strong>{videoFile.name}</strong><small>{Math.max(1, Math.round(videoFile.size / 1024))} КБ</small></div></div><button className={newStyles.removeFile} onClick={() => { setVideoFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} type="button">Удалить файл</button></div> : <label className={newStyles.dropzone} htmlFor="video-file"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 16v3h14v-3" /></svg><span>Перетащите файл сюда или выберите его</span><small>Поддерживаются видеофайлы</small><input ref={fileInputRef} id="video-file" name="video-file" onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)} type="file" accept="video/*" /></label>}
        <button className={newStyles.submit} disabled={!videoFile} type="submit">Продолжить</button>
      </form> : null}
    </section>
  </main>;
}
