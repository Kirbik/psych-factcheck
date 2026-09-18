import type { HTMLAttributes } from "react";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  icon?: string;
};

export function Badge({ children, className, icon, ...props }: BadgeProps) {
  return (
    <span className={["badge", className].filter(Boolean).join(" ")} {...props}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
