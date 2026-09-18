"use client";

import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { useRef, useState } from "react";
import styles from "./history-preview.module.css";
import profileStyles from "./profile-preview.module.css";

const inter = Inter({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-inter", weight: ["400", "500", "600"] });
const lora = Lora({ display: "swap", subsets: ["cyrillic", "latin"], variable: "--history-preview-lora", weight: ["600"] });

export function ProfilePreview() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [code, setCode] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const handleCodeChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const nextCodeParts = code.padEnd(6, " ").split("");
    nextCodeParts[index] = digit;
    const nextCode = nextCodeParts.join("").replace(/ /g, "");
    setCode(nextCode);
    if (digit && index < 5) codeInputRefs.current[index + 1]?.focus();
    if (nextCode.length === 6) {
      setIsModalOpen(false);
      setPasswordChanged(true);
      setCode("");
    }
  };

  const handleCodeKeyDown = (index: number, key: string) => {
    if (key === "Backspace" && !code[index] && index > 0) codeInputRefs.current[index - 1]?.focus();
  };

  return <main className={`${styles.preview} ${inter.variable} ${lora.variable}`}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Псих Фактчек — проверки"><span className={styles.mark}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.1 2.2 2.2 4.9-5" /></svg></span>Псих Фактчек</Link><nav className={styles.nav} aria-label="Навигация приложения"><Link href="/ui-preview/history">Проверки</Link><Link className={styles.navActive} href="/ui-preview/profile" aria-current="page">Профиль</Link></nav></header>
    <section className={`${styles.content} ${profileStyles.content}`} aria-labelledby="profile-title"><h1 className={profileStyles.title} id="profile-title">Профиль</h1><div className={profileStyles.card}><div className={profileStyles.field}><label htmlFor="profile-email">Адрес почты</label><input id="profile-email" className={profileStyles.email} type="email" value="user@example.com" readOnly /></div><div className={profileStyles.passwordRow}><div><label htmlFor="profile-password">Пароль</label><input aria-label="Пароль" className={profileStyles.passwordInput} id="profile-password" type="password" defaultValue="password123" /></div></div>{passwordChanged ? <p className={profileStyles.success} role="status">Пароль успешно изменён.</p> : null}<button className={profileStyles.saveButton} onClick={() => { setIsModalOpen(true); setPasswordChanged(false); }} type="button">Сохранить</button><button className={profileStyles.logoutButton} onClick={() => undefined} type="button">Выйти</button></div></section>
    {isModalOpen ? <div className={profileStyles.overlay} role="presentation"><div aria-labelledby="password-modal-title" aria-modal="true" className={profileStyles.modal} role="dialog"><button aria-label="Закрыть" className={profileStyles.close} onClick={() => { setIsModalOpen(false); setCode(""); }} type="button">×</button><h2 id="password-modal-title">Изменение пароля</h2><p>Введите 6‑значный код подтверждения.</p><label htmlFor="password-code">Код подтверждения</label>{Array.from({ length: 6 }, (_, index) => <input aria-label={`Цифра ${index + 1} из 6`} autoFocus={index === 0} className={profileStyles.codeInput} id={index === 0 ? "password-code" : undefined} inputMode="numeric" key={index} maxLength={1} onChange={(event) => handleCodeChange(index, event.target.value)} onKeyDown={(event) => handleCodeKeyDown(index, event.key)} pattern="[0-9]*" ref={(element) => { codeInputRefs.current[index] = element; }} value={code[index] ?? ""} />)} </div></div> : null}
  </main>;
}
