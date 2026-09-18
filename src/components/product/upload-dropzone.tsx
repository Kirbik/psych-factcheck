import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type UploadDropzoneProps = {
  actionLabel?: string;
  children?: ReactNode;
  description?: string;
  title?: string;
};

export function UploadDropzone({
  actionLabel = "Выбрать файл",
  children,
  description,
  title = "Перетащите видео сюда",
}: UploadDropzoneProps) {
  return (
    <section className="upload-dropzone" aria-labelledby="upload-dropzone-title">
      <span className="upload-dropzone__icon" aria-hidden="true">▱</span>
      <h2 id="upload-dropzone-title">{title}</h2>
      {description ? <p>{description}</p> : null}
      {children ?? <Button variant="secondary">{actionLabel}</Button>}
    </section>
  );
}
