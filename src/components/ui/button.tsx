import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: ButtonVariant;
};

export function Button({
  children,
  className,
  disabled,
  loading = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={["button", `button--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
