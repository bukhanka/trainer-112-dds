/** Small building blocks of the teacher and student cabinets. Plain Tailwind, no UI library. */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Tone = "neutral" | "blue" | "red" | "green" | "amber" | "dark";

const BADGE: Record<Tone, string> = {
  neutral: "bg-arm-panel text-arm-dark border-arm-gray",
  blue: "bg-arm-blue/10 text-arm-blue border-arm-blue/30",
  red: "bg-red-50 text-red-700 border-red-300",
  green: "bg-emerald-50 text-emerald-800 border-emerald-300",
  amber: "bg-amber-50 text-amber-800 border-amber-300",
  dark: "bg-arm-dark text-white border-arm-dark",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${BADGE[tone]} ${className}`}>
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-arm-blue text-white hover:bg-arm-blue/90 border-arm-blue",
  secondary: "bg-white text-arm-dark hover:bg-arm-panel border-arm-gray",
  danger: "bg-red-600 text-white hover:bg-red-700 border-red-600",
  success: "bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-700",
  ghost: "bg-transparent text-arm-blue hover:bg-arm-blue/10 border-transparent",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") {
  const pad = size === "sm" ? "h-8 px-2.5 text-sm" : "h-10 px-4 text-sm";
  return `inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${BUTTON[variant]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button type="button" {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function Section({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-arm-gray/70 bg-white p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {title && <h2 className="text-base font-semibold text-arm-dark">{title}</h2>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      {back && (
        <Link href={back.href} className="text-sm text-arm-blue hover:underline print:hidden">
          ← {back.label}
        </Link>
      )}
      {/* The title keeps at least 18rem: on a phone the buttons go under it instead of squeezing it into a column of words. */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 grow basis-72">
          <h1 className="text-xl font-semibold text-arm-dark">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-arm-desc">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-arm-gray bg-white/60 p-6 text-center text-sm text-arm-desc">{children}</div>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" }) {
  const color = tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-arm-dark";
  return (
    <div className="rounded border border-arm-gray/70 bg-white p-3">
      <div className="text-xs text-arm-desc">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="text-xs text-arm-desc">{hint}</div>}
    </div>
  );
}

export const LESSON_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Черновик", tone: "neutral" },
  RUNNING: { label: "Идёт", tone: "green" },
  FINISHED: { label: "Завершено", tone: "dark" },
};

export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "На проверке", tone: "amber" },
  CONFIRMED: { label: "Подтверждено", tone: "green" },
  OVERRIDDEN: { label: "Исправлено преподавателем", tone: "blue" },
};

/** Form control without a width, for inline controls. */
export const fieldClass =
  "rounded border border-arm-gray bg-white px-3 text-sm outline-none focus:border-arm-blue focus:ring-1 focus:ring-arm-blue/40 disabled:bg-arm-panel";

export const inputClass = `${fieldClass} h-10 w-full`;
