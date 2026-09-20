import { Button, AddressChip } from "./ui";
import { setLang, useLang, useT, type Lang } from "../lib/i18n";
import type { Session } from "../lib/session";

const LANGUAGES: Array<[Lang, string, string]> = [
  ["en", "EN", "English"],
  ["tr", "TR", "Türkçe"],
];

/** Two languages, so a segmented pair beats a dropdown. */
function LanguageToggle() {
  const lang = useLang();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("nav.language")}
      className="flex rounded-[var(--radius)] bg-secondary p-0.5"
    >
      {LANGUAGES.map(([code, short, full]) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          title={full}
          className={`min-h-10 rounded-[calc(var(--radius)-2px)] px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            lang === code
              ? "bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {short}
        </button>
      ))}
    </div>
  );
}

export function Header({
  session,
  connecting,
  onConnect,
  onDisconnect,
  view,
  onNavigate,
}: {
  session: Session | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  view: "vault" | "about";
  onNavigate: (view: "vault" | "about") => void;
}) {
  const t = useT();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="mr-auto flex items-center gap-3">
          {/* The wordmark is white ink: this app renders dark-only (see index.html). */}
          <h1 className="flex">
            <img src="/logo.png" alt={t("app.name")} width={900} height={220} className="h-5 w-auto" />
          </h1>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t("app.testnet")}
          </span>
        </div>

        <nav aria-label={t("nav.label")} className="flex gap-1">
          {(
            [
              ["vault", t("nav.vault")],
              ["about", t("nav.about")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={view === key ? "page" : undefined}
              className={`min-h-10 rounded-[var(--radius)] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                view === key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <LanguageToggle />

        {session ? (
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            <AddressChip address={session.address} label={t("wallet.yourAddress")} />
            <Button variant="ghost" onClick={onDisconnect}>
              {t("wallet.disconnect")}
            </Button>
          </div>
        ) : (
          <Button onClick={onConnect} loading={connecting}>
            {connecting ? t("wallet.connecting") : t("wallet.connect")}
          </Button>
        )}
      </div>

      {session && (
        <div className="border-t border-border bg-card/50">
          <div className="mx-auto max-w-5xl px-4 py-2 text-xs text-muted-foreground sm:px-6">
            {session.kyc === "idle" && t("kyc.idle")}
            {session.kyc === "pending" && t("kyc.pending")}
            {session.kyc === "accepted" && (
              <>
                {t("kyc.acceptedPrefix")}
                <span className="tnum">ACCEPTED</span>
                {t("kyc.acceptedSuffix")}
              </>
            )}
            {session.kyc === "failed" && (
              <span className="text-destructive">
                {t("kyc.failed", { error: session.kycError ?? t("kyc.unknownError") })}
              </span>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
