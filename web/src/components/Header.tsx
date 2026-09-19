import { Button, AddressChip } from "./ui";
import type { Session } from "../lib/session";

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
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="mr-auto flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight">USDC Kasası</h1>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Testnet
          </span>
        </div>

        <nav aria-label="Ana menü" className="flex gap-1">
          {(
            [
              ["vault", "Kasa"],
              ["about", "Mimari"],
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

        {session ? (
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full bg-primary"
              aria-hidden
            />
            <AddressChip address={session.address} label="Cüzdan adresiniz" />
            <Button variant="ghost" onClick={onDisconnect}>
              Çıkış
            </Button>
          </div>
        ) : (
          <Button onClick={onConnect} loading={connecting}>
            {connecting ? "Bağlanıyor…" : "Cüzdan bağla"}
          </Button>
        )}
      </div>

      {session && (
        <div className="border-t border-border bg-card/50">
          <div className="mx-auto max-w-5xl px-4 py-2 text-xs text-muted-foreground sm:px-6">
            {session.kyc === "idle" &&
              "Anchor kimlik doğrulaması ilk TL işleminizde, tek imzayla yapılır."}
            {session.kyc === "pending" && "Anchor kimlik doğrulaması yapılıyor…"}
            {session.kyc === "accepted" && (
              <>
                Anchor doğrulaması tamam (SEP-12 <span className="tnum">ACCEPTED</span>). TL
                giriş ve çıkışları bu kayıt üzerinden yapılır.
              </>
            )}
            {session.kyc === "failed" && (
              <span className="text-destructive">
                Anchor doğrulaması yapılamadı: {session.kycError ?? "bilinmeyen hata"}. USDC
                ile kasaya girebilirsiniz, ama TL giriş/çıkışı çalışmaz.
              </span>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
