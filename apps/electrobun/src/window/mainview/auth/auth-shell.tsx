import type { ReactNode } from "react";

/**
 * Shared chrome for every pre-game screen.
 *
 * The palette mirrors `classicTheme` (beige parchment #d5cfaa, dark brown
 * #514a3c, orange accent #ff6600) so the login / register / character screens
 * feel like a native continuation of the in-game HUD instead of the generic
 * dark-neutral placeholder they used to be.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="auth-shell relative flex h-full w-full items-center justify-center overflow-hidden px-6 py-8">
      {/* Layered backdrop: warm parchment wash + subtle vignette. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 600px at 50% -10%, #6b5f45 0%, #3d3628 55%, #211d15 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 22px)",
        }}
      />

      <div
        className={`relative w-full ${wide ? "max-w-4xl" : "max-w-md"}`}
        style={{ animation: "auth-rise 0.35s ease-out" }}
      >
        <header className="mb-3 text-center">
          <h1
            className="text-3xl font-bold tracking-wide text-[#ffd9a0] drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
            style={{ fontFamily: "var(--font-bitmini6, inherit)" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-[#e9dfc2]/80">{subtitle}</p>
          )}
        </header>

        <div
          className="rounded-xl p-6 shadow-[0_18px_50px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
          style={{
            background:
              "linear-gradient(180deg, #efe7c8 0%, #e2d7b0 60%, #d5cfaa 100%)",
            border: "2px solid #4e4028",
          }}
        >
          <div
            className="mb-4 h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, #4e4028 20%, #4e4028 80%, transparent)",
            }}
          />
          {children}
        </div>

        {footer && (
          <div className="mt-4 text-center text-sm text-[#e9dfc2]/80">
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes auth-rise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/** Dofus-styled text field, used by the login / register / create screens. */
export function AuthField({
  label,
  hint,
  error,
  ...input
}: {
  label: string;
  hint?: string;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#4e4028]">
        {label}
      </span>
      <input
        {...input}
        className="w-full rounded-md border-2 border-[#4e4028]/70 bg-[#fbf6e4] px-3 py-2 text-[#3a3220] outline-none transition placeholder:text-[#a89876] focus:border-[#ff6600] focus:ring-2 focus:ring-[#ff6600]/30"
      />
      {error ? (
        <span className="mt-1 block text-xs text-[#b3261e]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-[#7a6a4a]">{hint}</span>
      ) : null}
    </label>
  );
}

/** Primary / secondary action buttons matching the Dofus orange theme. */
export function AuthButton({
  variant = "primary",
  ...props
}: {
  variant?: "primary" | "ghost";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "w-full rounded-md px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-[#ff6600] text-white shadow-[0_3px_0_#b34700] hover:bg-[#ff7a1f] active:translate-y-px active:shadow-[0_1px_0_#b34700]"
      : "bg-transparent text-[#4e4028] underline-offset-2 hover:underline";
  return <button {...props} className={`${base} ${styles}`} />;
}

/** Inline error / info banner. */
export function AuthMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-md border-2 border-[#b3261e]/40 bg-[#fbe3e1] px-3 py-2 text-sm text-[#8a1c16]">
      {children}
    </div>
  );
}
