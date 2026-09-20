import { useState } from "react";
import { Button, AddressChip } from "./ui";
import { setLang, useLang, useT } from "../lib/i18n";
import type { Session } from "../lib/session";
export type View = "home" | "vault" | "about" | "learn" | "fees";

export function Header({ session, connecting, onConnect, onDisconnect, view }: {
  session: Session | null; connecting: boolean; onConnect: () => void;
  onDisconnect: () => void; view: View;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const labels = lang === "tr"
    ? [["vault", "Al / Sat"], ["learn", "Nasıl çalışır?"], ["fees", "Ücretler"], ["about", "Hakkımızda"]]
    : [["vault", "Buy / Sell"], ["learn", "How it works"], ["fees", "Fees"], ["about", "About us"]];
  return <header className="site-header" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); document.getElementById('menu-toggle')?.focus(); } }}>
    <div className={`shell header-inner${session ? " is-connected" : ""}`}>
      <a className="wordmark" href="#/home" aria-label="Stelpools" onClick={() => setOpen(false)}>
        <img src="/logo-dark-bg.png" alt="Stelpools" width="180" height="44" />
      </a>
      <nav className="desktop-nav" aria-label={t("nav.label")}>
        {labels.map(([key, label]) => <a key={key} href={`#/${key}`} aria-current={view === key ? "page" : undefined}>{label}</a>)}
      </nav>
      <div className="header-actions">
        <button className="language-button" onClick={() => setLang(lang === "en" ? "tr" : "en")} aria-label={lang === 'tr' ? 'Switch to English' : 'Türkçeye geç'}>{lang.toUpperCase()} <span aria-hidden>⌄</span></button>
        {session ? <><AddressChip address={session.address} label={t("wallet.yourAddress")} /><Button variant="ghost" onClick={onDisconnect}>{t("wallet.disconnect")}</Button></> :
          <Button className="header-connect" onClick={onConnect} loading={connecting}>{connecting ? t("wallet.connecting") : t("wallet.connect")}</Button>}
        <button id="menu-toggle" className="menu-toggle" aria-expanded={open} aria-controls="mobile-nav" aria-label={lang === 'tr' ? 'Menü' : 'Menu'} onClick={() => setOpen(!open)}><span aria-hidden>{open ? "×" : "☰"}</span></button>
      </div>
    </div>
    {open && <nav id="mobile-nav" className="mobile-nav shell" aria-label={t('nav.label')}>{labels.map(([key, label]) => <a key={key} href={`#/${key}`} aria-current={view === key ? "page" : undefined} onClick={() => setOpen(false)}>{label}<span aria-hidden>↗</span></a>)}</nav>}
    {session && <div className="session-bar shell">{session.kyc === 'idle' ? t('kyc.idle') : session.kyc === 'pending' ? t('kyc.pending') : session.kyc === 'failed' ? t('kyc.failed', { error: session.kycError ?? t('kyc.unknownError') }) : `${t('kyc.acceptedPrefix')} ACCEPTED ${t('kyc.acceptedSuffix')}`}</div>}
  </header>;
}
