import type { HTMLAttributes } from "react";

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "error";
};

export function Alert({ children, className, tone = "info", ...props }: AlertProps) {
  return (
    <div
      className={["alert", `alert--${tone}`, className].filter(Boolean).join(" ")}
      role={tone === "error" ? "alert" : "status"}
      {...props}
    >
      <span aria-hidden="true">{tone === "error" ? "!" : "i"}</span>
      <div>{children}</div>
    </div>
  );
}
