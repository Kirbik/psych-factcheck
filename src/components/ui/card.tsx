import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={["card", className].filter(Boolean).join(" ")} {...props} />;
}
