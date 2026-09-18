import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Psych Factcheck",
  description: "Evidence-grounded fact-checking for psychology content.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
