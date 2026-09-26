import type { Metadata } from "next";
import { VideoUploadProvider } from "@/features/analysis/video-upload-provider";
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
      <body>
        <VideoUploadProvider>{children}</VideoUploadProvider>
      </body>
    </html>
  );
}
