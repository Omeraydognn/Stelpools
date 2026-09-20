import { useCallback, useEffect, useRef, useState } from "react";

import { Header, type View } from "./components/Header";
import { VaultView } from "./components/VaultView";
import { ErrorState } from "./components/ui";
import { Home, InfoPage, Footer } from "./components/Marketing";
import { useT } from "./lib/i18n";
import { useCopy } from "./lib/useCopy";
import type { Session } from "./lib/session";
import { connectWallet, forgetWallet, isUserRejection, restoreWallet } from "./lib/wallet";

function readHash(): View {
  const page = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return ["home", "vault", "about", "learn", "fees"].includes(page) ? page as View : "home";
}

export default function App() {
  const t = useT();
  const c = useCopy();
  const [view, setView] = useState<View>(readHash);
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<Error | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#main') return;
      setView(readHash());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
    <div className="app-shell">
      <a href="#main" className="skip-link">{t("app.skipToContent")}</a>
      <Header session={session} connecting={connecting} onConnect={() => void onConnect()} onDisconnect={onDisconnect} view={view} />
      {connectError && <div className="shell connect-error"><ErrorState error={connectError} onRetry={() => void onConnect()} /></div>}
      <main id="main" tabIndex={-1}>
        {view === 'home' && <Home />}
        {view === 'vault' && <>
          <div className="trading-intro"><div className="shell"><div><span className="eyebrow">{c('YOUR MONEY, IN MOTION', 'PARANIZ HAREKETE GEÇSİN')}</span><h1>{c('One pool.', 'Tek havuz.')} <em>{c('More possibilities.', 'Daha fazla olanak.')}</em></h1><p>{c('Buy, sell and provide liquidity. Directly on Stellar.', 'Alın, satın ve likidite sağlayın. Doğrudan Stellar üzerinde.')}</p></div><span className="testnet-chip"><span className="status-dot"/>Stellar Testnet</span></div></div>
          <div className="shell trading-content"><div className="testnet-notice" role="status">{c('Testnet environment. Use test assets only — bank transfers are simulated.', 'Testnet ortamı. Yalnızca test varlıkları kullanın — banka transferleri simüle edilir.')}</div><VaultView address={session?.address ?? null} onConnect={() => void onConnect()} connecting={connecting}/></div>
        </>}
        {view !== 'home' && view !== 'vault' && <InfoPage key={view} view={view}/>}
      </main>
      <Footer />
    </div>
  );
}
