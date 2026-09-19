import { useCallback, useEffect, useRef, useState } from "react";

import { Header } from "./components/Header";
import { VaultView } from "./components/VaultView";
import { ErrorState } from "./components/ui";
import { useT } from "./lib/i18n";
import type { Session } from "./lib/session";
import { connectWallet, forgetWallet, isUserRejection, restoreWallet } from "./lib/wallet";

type View = { name: "vault" } | { name: "about" };

/** The URL hash is the router; the vault is the whole product for now. */
function readHash(): View {
  return window.location.hash.replace(/^#\/?/, "") === "about"
    ? { name: "about" }
    : { name: "vault" };
}

export default function App() {
  const t = useT();
  const [view, setView] = useState<View>(readHash);
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<Error | null>(null);

  useEffect(() => {
    const onHashChange = () => setView(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = next.name === "vault" ? "/vault" : "/about";
    setView(next);
  }, []);

  const restored = useRef(false);

  /**
   * Connecting a wallet asks for nothing.
   *
   * SEP-10 costs a signature, and doing it on connect meant a popup before
   * the user had asked for anything. The anchor flows obtain the token
   * themselves on the first lira action and register the customer as part of
   * it, so there is nothing to do here.
   */
  const startSession = useCallback((address: string) => {
    setSession({ address, kyc: "idle" });
  }, []);

  useEffect(() => {
    // StrictMode runs effects twice in development; reconnecting twice would
    // ask the wallet twice.
    if (restored.current) return;
    restored.current = true;
    void restoreWallet().then((address) => {
      if (address) startSession(address);
    });
  }, [startSession]);

  async function onConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      startSession(await connectWallet());
    } catch (err) {
      // Closing the wallet dialog is a decision, not a failure.
      if (!isUserRejection(err)) {
        setConnectError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      setConnecting(false);
    }
  }

  function onDisconnect() {
    forgetWallet(session?.address);
    setSession(null);
  }

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius)] focus:bg-card focus:px-4 focus:py-2 focus:text-sm"
      >
        {t("app.skipToContent")}
      </a>

      <Header
        session={session}
        connecting={connecting}
        onConnect={() => void onConnect()}
        onDisconnect={onDisconnect}
        view={view.name === "about" ? "about" : "vault"}
        onNavigate={(next) => navigate({ name: next })}
      />

      <main id="main" className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:px-6">
        {connectError && <ErrorState error={connectError} onRetry={() => void onConnect()} />}

        {view.name === "vault" && <VaultView address={session?.address ?? null} />}

        {view.name === "about" && (
          <section aria-labelledby="about-heading" className="grid max-w-2xl gap-3">
            <h2 id="about-heading" className="text-xl font-semibold tracking-tight">
              {t("about.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("about.p1")}</p>
            <p className="text-sm text-muted-foreground">{t("about.p2")}</p>
            <p className="text-sm text-muted-foreground">
              {t("about.contract")}{" "}
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${import.meta.env.VITE_VAULT_CONTRACT_ID}`}
                target="_blank"
                rel="noreferrer"
                className="tnum text-primary underline underline-offset-4"
              >
                {String(import.meta.env.VITE_VAULT_CONTRACT_ID).slice(0, 12)}…
              </a>
            </p>
          </section>
        )}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
        <p>{t("footer.note")}</p>
      </footer>
    </div>
  );
}
