import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

import { truncateAddress } from "../lib/format";
import { useT } from "../lib/i18n";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const variants = {
    primary: "button-primary hover:opacity-90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
    ghost: "bg-transparent text-foreground border border-border hover:bg-accent",
    destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${focusRing} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag className={`surface-card rounded-[var(--radius)] border border-border bg-card p-6 ${className}`}>
      {children}
    </Tag>
  );
}

/** Amounts are always mono + tabular so they never jitter as they update. */
export function Amount({
  value,
  unit,
  size = "md",
  className = "",
}: {
  value: string;
  unit: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { sm: "text-sm", md: "text-lg", lg: "text-2xl" };
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className={`tnum font-semibold tracking-tight ${sizes[size]}`}>{value}</span>
      <span className="text-xs font-medium text-muted-foreground">{unit}</span>
    </span>
  );
}

export function AddressChip({ address, label }: { address: string; label?: string }) {
  const t = useT();
  const copy = () => void navigator.clipboard?.writeText(address);
  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      aria-label={`${label ? `${label}: ` : ""}${address} — ${t("wallet.copyHint")}`}
      className={`tnum inline-flex min-h-10 items-center rounded-[var(--radius)] px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground ${focusRing}`}
    >
      {truncateAddress(address)}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-[var(--radius)] bg-secondary motion-reduce:animate-none ${className}`}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-4"
    >
      <div>
        <p className="text-sm font-medium">{t("ui.wentWrong")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      </div>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          {t("ui.retry")}
        </Button>
      )}
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: string;
};

export function Field({ label, hint, error, suffix, id, className = "", ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = [error && `${inputId}-error`, hint && `${inputId}-hint`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`tnum min-h-10 w-full rounded-[var(--radius)] border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground ${
            error ? "border-destructive" : "border-border"
          } ${suffix ? "pr-14" : ""} ${focusRing} ${className}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
