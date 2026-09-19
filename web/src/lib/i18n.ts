import { useSyncExternalStore } from "react";

/**
 * Two languages, English first.
 *
 * The app is built for a Turkish on-ramp but judged and read in English, so
 * English is the default and Turkish is one click away. The choice is kept
 * per browser; nothing about it reaches the chain or the anchor.
 */
export type Lang = "en" | "tr";

const STORAGE_KEY = "stelpools.lang";
const DEFAULT: Lang = "en";

function readStored(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "tr") return stored;
  } catch {
    // Private mode, or storage blocked. The default is still correct.
  }
  return DEFAULT;
}

let current: Lang = readStored();
const listeners = new Set<() => void>();

if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => DEFAULT);
}

/** The Intl locale that matches the current language. */
export function locale(): string {
  return current === "tr" ? "tr-TR" : "en-US";
}

/** A number formatted the way the current language writes numbers. */
export function num(value: number, digits = 2, maxDigits = digits): string {
  return value.toLocaleString(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: maxDigits,
  });
}

/** Stroops (7 decimals) formatted for display. */
export function usdc(stroops: bigint | number, digits = 2): string {
  return num(Number(stroops) / 1e7, digits);
}

/** A percentage, with the sign where the language puts it. */
export function pct(value: number, digits = 2): string {
  return current === "tr" ? `%${num(value, digits)}` : `${num(value, digits)}%`;
}

export function dateTime(at: Date): string {
  return at.toLocaleString(locale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Entry = { en: string; tr: string };

/**
 * Every user-visible string.
 *
 * Kept in one place with both languages adjacent so a change to one is
 * impossible to make without seeing the other.
 */
export const dict = {
  // ---- shell ----
  "app.name": { en: "Stelpools", tr: "Stelpools" },
  "app.testnet": { en: "Testnet", tr: "Testnet" },
  "app.skipToContent": { en: "Skip to content", tr: "İçeriğe geç" },
  "nav.label": { en: "Main menu", tr: "Ana menü" },
  "nav.vault": { en: "Pool", tr: "Kasa" },
  "nav.about": { en: "Architecture", tr: "Mimari" },
  "nav.language": { en: "Language", tr: "Dil" },
  "wallet.connect": { en: "Connect wallet", tr: "Cüzdan bağla" },
  "wallet.connecting": { en: "Connecting…", tr: "Bağlanıyor…" },
  "wallet.disconnect": { en: "Disconnect", tr: "Çıkış" },
  "wallet.yourAddress": { en: "Your wallet address", tr: "Cüzdan adresiniz" },
  "wallet.copyHint": { en: "click to copy", tr: "kopyalamak için tıklayın" },
  "wallet.rejected": { en: "Wallet connection cancelled", tr: "Cüzdan bağlantısı iptal edildi" },
  "wallet.notConnected": { en: "Wallet not connected", tr: "Cüzdan bağlı değil" },

  // ---- KYC banner ----
  "kyc.idle": {
    en: "Anchor verification happens on your first lira action, with a single signature.",
    tr: "Anchor kimlik doğrulaması ilk TL işleminizde, tek imzayla yapılır.",
  },
  "kyc.pending": {
    en: "Verifying your identity with the anchor…",
    tr: "Anchor kimlik doğrulaması yapılıyor…",
  },
  "kyc.acceptedPrefix": { en: "Anchor verification complete (SEP-12 ", tr: "Anchor doğrulaması tamam (SEP-12 " },
  "kyc.acceptedSuffix": {
    en: "). Lira in and out runs through this record.",
    tr: "). TL giriş ve çıkışları bu kayıt üzerinden yapılır.",
  },
  "kyc.failed": {
    en: "Anchor verification failed: {error}. You can still enter the pool with USDC, but lira in/out will not work.",
    tr: "Anchor doğrulaması yapılamadı: {error}. USDC ile kasaya girebilirsiniz, ama TL giriş/çıkışı çalışmaz.",
  },
  "kyc.unknownError": { en: "unknown error", tr: "bilinmeyen hata" },

  // ---- about page ----
  "about.heading": { en: "Architecture", tr: "Mimari" },
  "about.p1": {
    en: "The fiat (TRY) leg belongs to the anchor: every lira in and out moves through its corporate IBAN over SEP-6. The crypto (USDC) leg belongs to the Soroban vault: it pools the incoming USDC and keeps everyone's share.",
    tr: "Fiat (TRY) tarafının sorumlusu Mock Anchor'dır: tüm TL giriş ve çıkışları onun kurumsal IBAN'ı üzerinden, SEP-6 ile yürür. Kripto (USDC) tarafının sorumlusu Soroban kasasıdır: gelen USDC'yi havuzda toplar ve herkesin payını tutar.",
  },
  "about.p2": {
    en: "Wallets pass through SEP-10 and SEP-12 in the background before a transaction. The pool's rate always comes from the anchor's SEP-38 pricing.",
    tr: "Cüzdanlar işlemden önce arka planda SEP-10 ve SEP-12'den geçer. Havuzun kuru daima anchor'ın SEP-38 fiyatlamasından beslenir.",
  },
  "about.contract": { en: "Vault contract:", tr: "Kasa kontratı:" },
  "footer.note": {
    en: "Stellar testnet · the USDC vault lives on Soroban, lira in/out and pricing go through tr-mock-anchor. No real money moves.",
    tr: "Stellar testnet · USDC kasası Soroban'da, TL giriş/çıkışı ve fiyatlama tr-mock-anchor üzerinden. Gerçek para hareket etmez.",
  },

  // ---- generic ui ----
  "ui.wentWrong": { en: "Something went wrong", tr: "Bir şeyler ters gitti" },
  "ui.retry": { en: "Try again", tr: "Tekrar dene" },
  "ui.refresh": { en: "Refresh", tr: "Yenile" },
  "ui.cancel": { en: "Cancel", tr: "Vazgeç" },
  "ui.copy": { en: "copy", tr: "kopyala" },
  "ui.copied": { en: "copied", tr: "kopyalandı" },
  "ui.copyLabel": { en: "copy {label}", tr: "{label} kopyala" },
  "ui.all": { en: "Max", tr: "Tümü" },
  "ui.working": { en: "Working…", tr: "Çalışıyor…" },
  "ui.processing": { en: "Processing…", tr: "İşleniyor…" },
  "ui.connectFirst": { en: "Connect a wallet first", tr: "Önce cüzdan bağlayın" },
  "ui.none": { en: "—", tr: "—" },

  // ---- transaction stages ----
  "stage.building": { en: "Preparing…", tr: "Hazırlanıyor…" },
  "stage.signing": { en: "Sign in your wallet…", tr: "Cüzdanınızda imzalayın…" },
  "stage.submitting": { en: "Submitting…", tr: "Gönderiliyor…" },
  "stage.confirming": { en: "Waiting for confirmation…", tr: "Onay bekleniyor…" },
  "stage.authenticating": { en: "Connecting to the anchor…", tr: "Anchor'a bağlanılıyor…" },
  "stage.registering": { en: "Registering your identity…", tr: "Kimlik kaydı yapılıyor…" },
  "stage.requesting": { en: "Opening the anchor transaction…", tr: "Anchor işlemi açılıyor…" },
  "stage.requestingInstructions": { en: "Fetching instructions…", tr: "Talimat alınıyor…" },
  "stage.transferring": { en: "Sending the transfer…", tr: "Transfer gönderiliyor…" },
  "stage.reportingTransfer": { en: "Reporting the transfer…", tr: "Transfer bildiriliyor…" },
  "stage.waiting": { en: "Anchor is working…", tr: "Anchor işliyor…" },
  "stage.done": { en: "Done", tr: "Tamamlandı" },

  // ---- anchor statuses ----
  "anchorStatus.pending_user_transfer_start": {
    en: "The anchor is waiting for your money.",
    tr: "Anchor paranızı bekliyor.",
  },
  "anchorStatus.pending_user_transfer_complete": {
    en: "Your transfer arrived; the anchor is working on it.",
    tr: "Transferiniz alındı, anchor işliyor.",
  },
  "anchorStatus.pending_anchor": {
    en: "The anchor received the TRY and is sending the USDC.",
    tr: "Anchor TRY'yi aldı, USDC'yi gönderiyor.",
  },
  "anchorStatus.pending_stellar": {
    en: "The payment is being submitted to the Stellar network.",
    tr: "Ödeme Stellar ağına gönderiliyor.",
  },
  "anchorStatus.pending_trust": {
    en: "The anchor cannot send the USDC: your wallet has no USDC trustline.",
    tr: "Anchor USDC'yi gönderemiyor: cüzdanınızda USDC trustline yok.",
  },
  "anchorStatus.pending_receiver": { en: "The anchor is preparing the payout.", tr: "Anchor ödemeyi hazırlıyor." },
  "anchorStatus.completed": { en: "Completed.", tr: "Tamamlandı." },

  // ---- ramp status panel ----
  "ramp.anchorSays": { en: "Anchor: {message}", tr: "Anchor: {message}" },
  "ramp.seconds": { en: "{n} s", tr: "{n} sn" },
  "ramp.trustlineFix": {
    en: "The moment you open the trustline the anchor stops waiting and sends the USDC — the transaction was not cancelled.",
    tr: "Trustline'ı açtığınız anda anchor beklemeyi bırakıp USDC'yi gönderir — işlem iptal olmadı.",
  },
  "ramp.openTrustlineNow": { en: "Open the USDC trustline now", tr: "USDC trustline'ı şimdi aç" },
  "ramp.slow": {
    en: "This is taking a while. Do not close the page; the anchor transaction continues in the background.",
    tr: "Bu biraz uzun sürüyor. Sayfayı kapatmayın; anchor işlemi arka planda devam ediyor.",
  },

  // ---- requirements ----
  "req.before": { en: "Before you continue:", tr: "Devam etmeden önce:" },
  "req.noAccount": {
    en: "Your wallet account does not exist on this network. On testnet you can create it with friendbot.",
    tr: "Cüzdan hesabınız bu ağda yok. Testnet'te friendbot ile oluşturabilirsiniz.",
  },
  "req.noTrustlineBuy": {
    en: "Your wallet needs a USDC trustline before it can receive USDC.",
    tr: "USDC'yi alabilmek için cüzdanınızda USDC trustline olmalı.",
  },
  "req.noTrustline": { en: "Your wallet has no USDC trustline.", tr: "Cüzdanınızda USDC trustline yok." },
  "req.needXlm": {
    en: "You need about {needed} XLM for the stake and fees; your spendable balance is {have} XLM.",
    tr: "Teminat ve ücretler için ~{needed} XLM gerekiyor, kullanılabilir bakiyeniz {have} XLM.",
  },
  "req.needUsdc": {
    en: "You want to add {needed} USDC to the pool but your balance is {have} USDC.",
    tr: "Havuza {needed} USDC eklemek istiyorsunuz ama bakiyeniz {have} USDC.",
  },
  "req.needFeeXlm": { en: "You need a little XLM for transaction fees.", tr: "İşlem ücretleri için biraz XLM gerekiyor." },
  "req.addTrustline": { en: "Add USDC trustline", tr: "USDC'yi tanımla" },
  "req.fundFriendbot": { en: "Fund with friendbot", tr: "Friendbot ile fonla" },

  // ---- pool header ----
  "pool.pair": { en: "USDC / TRY", tr: "USDC / TRY" },
  "pool.tagline": {
    en: "Turn TRY into USDC, put it to work in the vault if you want, and leave whenever you like.",
    tr: "TRY'yi USDC'ye çevir, istersen kasada çalıştır, istediğinde geri çık.",
  },
  "pool.contract": { en: "Contract", tr: "Kontrat" },
  "pool.tvl": { en: "TVL", tr: "TVL" },
  "pool.tvlTry": { en: "TVL (TRY)", tr: "TVL (TRY)" },
  "pool.sharePrice": { en: "Share price", tr: "Pay fiyatı" },
  "pool.withdrawFee": { en: "Withdrawal fee", tr: "Çıkış komisyonu" },
  "pool.apr": { en: "Yield (annual)", tr: "Getiri (yıllık)" },
  "pool.advanced": { en: "Fronted", tr: "Önden verilen" },

  // ---- price chart ----
  "chart.needMore": {
    en: "The chart needs at least two events. As the first deposits land, the share price is drawn here.",
    tr: "Grafik için en az iki hareket gerekiyor. Kasaya ilk yatırımlar yapıldıkça pay fiyatı burada çizilir.",
  },
  "chart.alt": {
    en: "Share price from {from} USDC to {to} USDC",
    tr: "Pay fiyatı {from} USDC'den {to} USDC'ye",
  },
  "chart.events": { en: "{n} events", tr: "{n} hareket" },
  "chart.window": { en: " · last {h} hours", tr: " · son {h} saat" },
  "chart.perShare": { en: "USDC/share", tr: "USDC/pay" },
  "chart.title": { en: "Share price", tr: "Pay fiyatı" },
  "chart.source": {
    en: "From the vault's own events; it reaches back as far as the RPC's ledger window.",
    tr: "Kasanın kendi event'lerinden; RPC'nin sakladığı son ledger penceresi kadar geriye gider.",
  },

  // ---- position ----
  "position.title": { en: "Your position", tr: "Pozisyonunuz" },
  "position.connect": {
    en: "Connect your wallet to see your position.",
    tr: "Pozisyonunuzu görmek için cüzdanınızı bağlayın.",
  },
  "position.empty": {
    en: "You have no shares in the vault. Use the panel on the right to enter with TRY or USDC.",
    tr: "Kasada payınız yok. Sağdaki panelden TRY ya da USDC ile girebilirsiniz.",
  },
  "position.shares": { en: "Your shares", tr: "Payınız" },
  "position.value": { en: "Value", tr: "Değeri" },
  "position.inTry": { en: "In TRY", tr: "TRY karşılığı" },
  "position.pnlPrefix": { en: "In this window you put in a net ", tr: "Bu pencerede net " },
  "position.pnlMid": { en: " USDC, worth ", tr: " USDC koydunuz, bugünkü değeri " },
  "position.pnlSuffix": { en: " USDC today — ", tr: " USDC — " },
  "position.pnlTail": {
    en: ". Deposits older than this window are not counted.",
    tr: ". Daha eski yatırmalar bu hesaba girmez.",
  },

  // ---- tabs ----
  "tab.group": { en: "Action", tr: "İşlem" },
  "tab.swap": { en: "Swap", tr: "Takas" },
  "tab.deposit": { en: "Deposit", tr: "Yatır" },
  "tab.withdraw": { en: "Withdraw", tr: "Çek" },
  "tab.pausedNote": {
    en: "Deposits are paused for now. Withdrawals are open.",
    tr: "Yatırımlar geçici olarak durduruldu. Çekimler açık.",
  },

  // ---- swap ----
  "swap.youPay": { en: "You pay", tr: "Ödeyeceğiniz" },
  "swap.youSell": { en: "You sell", tr: "Satacağınız" },
  "swap.youGet": { en: "You receive", tr: "Alacağınız" },
  "swap.flip": { en: "Flip direction", tr: "Yönü çevir" },
  "swap.rateNote": {
    en: "Rate {rate} TRY/USDC — the anchor's SEP-38 pricing, including a 0.5% spread. Sudden sharp moves in the rate do not come from us.",
    tr: "Kur {rate} TRY/USDC — anchor'ın SEP-38 fiyatlaması, %0,5 spread dahil. Kurdaki ani ve yüksek dalgalanmalar bizden kaynaklanmaz.",
  },
  "swap.limits": { en: "Anchor limits are {min} – {max} TRY.", tr: "Anchor limitleri {min} – {max} TRY." },
  "swap.youHaveUsdc": { en: "You have {amount} USDC in your wallet.", tr: "Cüzdanınızda {amount} USDC var." },
  "swap.ibanLabel": { en: "IBAN to receive the TRY", tr: "TRY'yi alacağınız IBAN" },
  "swap.bankLabel": { en: "Bank name", tr: "Banka adı" },
  "swap.bankPlaceholder": { en: "e.g. Akbank", tr: "Örn. Akbank" },
  "swap.instantTitle": { en: "Get it instantly", tr: "Anında al" },
  "swap.instantBody": {
    en: "The pool hands over the USDC the moment you report the transfer; you close the advance when the anchor's USDC arrives. A 0.3% fee stays in the pool.",
    tr: "Havaleyi bildirdiğiniz anda havuz USDC'yi verir; anchor'ın USDC'si geldiğinde avansı kapatırsınız. %0,3 komisyon havuzda kalır.",
  },
  "swap.step1In": {
    en: "1. The anchor verifies you and gives you its own IBAN plus a code",
    tr: "1. Anchor kimliğinizi doğrular ve size kendi IBAN'ını + bir kod verir",
  },
  "swap.step2In": {
    en: "2. You send TRY to that IBAN from your bank, with the code in the description",
    tr: "2. Bankanızdan o IBAN'a, açıklamaya kodu yazarak TRY gönderirsiniz",
  },
  "swap.step3Instant": {
    en: "3. The pool pays the USDC right away; you close the advance when the anchor's arrives",
    tr: "3. Havuz USDC'yi hemen öder; anchor'ınki gelince avansı kapatırsınız",
  },
  "swap.step3Normal": {
    en: "3. When the anchor sees the money it sends USDC to your Stellar wallet",
    tr: "3. Anchor parayı görünce USDC'yi Stellar cüzdanınıza gönderir",
  },
  "swap.step1Out": { en: "1. Your IBAN is registered with the anchor over SEP-12", tr: "1. IBAN'ınız anchor'a SEP-12 ile kaydedilir" },
  "swap.step2Out": {
    en: "2. Your USDC goes to the anchor's treasury as a payment carrying a memo",
    tr: "2. USDC'niz anchor hazinesine memo'lu ödemeyle gider",
  },
  "swap.step3Out": { en: "3. The anchor pays the TRY to your IBAN (FAST)", tr: "3. Anchor TRY'yi IBAN'ınıza öder (FAST)" },
  "swap.needTrustline": {
    en: "Your wallet has no USDC trustline. The anchor cannot send the USDC and the transaction would wait forever — open it with the \"Add USDC trustline\" button above.",
    tr: "Cüzdanınızda USDC trustline yok. Anchor USDC'yi gönderemez ve işlem sonsuza kadar bekler — yukarıdaki \"USDC'yi tanımla\" düğmesiyle açın.",
  },
  "swap.getInstructions": { en: "Get transfer instructions", tr: "Yatırma talimatı al" },
  "swap.cashOut": { en: "Convert USDC to TRY", tr: "USDC'yi TRY'ye çevir" },
  "swap.counterparty": {
    en: "The counterparty for this swap is the anchor, not the pool — no contract can hold a bank balance. The pool holds the USDC, earns on it, and can pay you up front instead of making you wait for the anchor.",
    tr: "Bu takasın karşı tarafı anchor'dır, havuz değil — hiçbir kontrat banka bakiyesi tutamaz. Havuz USDC'yi tutar, getirisini üretir ve isterseniz anchor'ı beklemeden önden öder.",
  },
  "swap.receiptAdvance": {
    en: "{paid} USDC went straight from the pool to your wallet. Close the {owed} USDC advance when the anchor's USDC arrives.",
    tr: "{paid} USDC havuzdan hemen cüzdanınıza geçti. Anchor'ın USDC'si geldiğinde {owed} USDC'lik avansı kapatın.",
  },
  "swap.receiptDeposit": {
    en: "{amount} USDC is in your wallet. Use the \"Deposit\" tab if you want to put it into the vault.",
    tr: "{amount} USDC cüzdanınıza geçti. Kasaya yatırmak isterseniz \"Yatır\" sekmesi.",
  },
  "swap.receiptCashOut": { en: "The anchor sent {amount} TRY to your IBAN.", tr: "Anchor {amount} TRY'yi IBAN'ınıza gönderdi." },

  // ---- deposit instructions ----
  "inst.title": { en: "Send from your bank to this account", tr: "Bankanızdan bu hesaba gönderin" },
  "inst.body": {
    en: "Write the code in the description exactly as shown — the anchor uses it to match the money to your transaction. Without the code the transfer will not be matched.",
    tr: "Açıklamaya kodu birebir yazın — anchor parayı bu kodla sizin işleminize bağlar. Kod olmadan transfer eşleşmez.",
  },
  "inst.bank": { en: "Bank", tr: "Banka" },
  "inst.iban": { en: "IBAN", tr: "IBAN" },
  "inst.amount": { en: "Amount", tr: "Tutar" },
  "inst.reference": { en: "Description", tr: "Açıklama" },
  "inst.sandboxNote": {
    en: "Testnet: since no real transfer is possible, the anchor's sandbox can record it for you. On mainnet this button does not exist — you send the money from your own bank.",
    tr: "Testnet: gerçek bir havale yapılamayacağı için anchor'ın sandbox'ı transferi sizin yerinize kaydedebilir. Canlıda bu düğme olmaz; parayı bankanızdan siz gönderirsiniz.",
  },
  "inst.simulate": { en: "I sent the transfer (sandbox)", tr: "Havaleyi gönderdim (sandbox)" },
  "inst.simulated": { en: "Transfer recorded", tr: "Transfer kaydedildi" },

  // ---- advance banner ----
  "advance.title": { en: "You have an open advance", tr: "Açık avansınız var" },
  "advance.bodyPrefix": {
    en: "The vault lent you ",
    tr: "Kasa, anchor'ın USDC'yi göndermesini beklemeden size ",
  },
  "advance.bodySuffix": {
    en: " USDC without waiting for the anchor to deliver. Repay it once the anchor's USDC lands in your wallet — the fee is credited to everyone left in the pool.",
    tr: " USDC'lik bir borç açtı. Anchor'ın USDC'si cüzdanınıza düştüğünde bunu geri ödeyin — komisyon havuzda kalan herkese yazılır.",
  },
  "advance.repay": { en: "Repay {amount} USDC and close", tr: "{amount} USDC öde ve kapat" },

  // ---- deposit panel ----
  "dep.method": { en: "Deposit method", tr: "Yatırma yöntemi" },
  "dep.withTry": { en: "With TRY", tr: "TRY ile" },
  "dep.withUsdc": { en: "With USDC", tr: "USDC ile" },
  "dep.amount": { en: "Amount to deposit", tr: "Yatırılacak" },
  "dep.tryHint": { en: "Anchor limits: 50 – 3,000 TRY", tr: "Anchor limitleri: 50 – 3.000 TRY" },
  "dep.tryHintTr": { en: "Anchor limits: 50 – 3,000 TRY", tr: "Anchor limitleri: 50 – 3.000 TRY" },
  "dep.estimate": { en: "Going into the vault (estimated)", tr: "Kasaya girecek (tahmini)" },
  "dep.rateNote": {
    en: "Rate {rate} TRY/USDC — the anchor's SEP-38 pricing. Sudden sharp moves in the rate do not come from us.",
    tr: "Kur {rate} TRY/USDC — anchor'ın SEP-38 fiyatlaması. Kurdaki ani ve yüksek dalgalanmalar bizden kaynaklanmaz.",
  },
  "dep.step1": {
    en: "1. TRY transfer to the anchor (simulated in the sandbox) → USDC arrives in your wallet",
    tr: "1. Anchor'a TRY transferi (sandbox'ta simüle edilir) → cüzdanınıza USDC geçer",
  },
  "dep.step2": {
    en: "2. In the same flow the USDC is deposited into the vault and you receive shares",
    tr: "2. Aynı akışta USDC kasaya yatırılır ve pay alırsınız",
  },
  "dep.needTrustline": {
    en: "Your wallet has no USDC trustline. The anchor cannot send the USDC and the transaction will stay pending.",
    tr: "Cüzdanınızda USDC trustline yok. Anchor USDC'yi gönderemez ve işlem beklemede kalır.",
  },
  "dep.depositTryCta": { en: "Deposit TRY and enter the vault", tr: "TRY yatır ve kasaya gir" },
  "dep.depositUsdcCta": { en: "Deposit into the vault", tr: "Kasaya yatır" },
  "dep.receiptTry": {
    en: "{assets} USDC deposited into the vault; you received {shares} shares.",
    tr: "{assets} USDC kasaya yatırıldı, {shares} pay aldınız.",
  },
  "dep.receiptUsdc": { en: "You received {shares} shares. Transaction: {hash}…", tr: "{shares} pay aldınız. İşlem: {hash}…" },
  "dep.badAnchorAmount": { en: "Could not read the amount returned by the anchor.", tr: "Anchor'dan gelen tutar okunamadı." },
  "dep.badUsdcAmount": { en: "Enter a valid USDC amount.", tr: "Geçerli bir USDC tutarı girin." },

  // ---- withdraw panel ----
  "wd.shares": { en: "Shares to withdraw", tr: "Çekilecek pay" },
  "wd.hint": {
    en: "You hold {shares} {symbol}, worth {value} USDC today.",
    tr: "{shares} {symbol} payınız var, bugünkü değeri {value} USDC.",
  },
  "wd.feeNote": {
    en: "A {fee} withdrawal fee is deducted and stays in the vault — so it is credited to everyone who remains.",
    tr: "{fee} çıkış komisyonu düşülür ve kasada kalır; yani kasada kalanların payına yazılır.",
  },
  "wd.toBank": { en: "Then send it to my bank account as TRY", tr: "Devamında TRY olarak banka hesabıma gönder" },
  "wd.bankNote": {
    en: "The USDC lands in your wallet first, then goes to the anchor's treasury, and the anchor pays the TRY to your IBAN. Two signatures are requested.",
    tr: "USDC önce cüzdanınıza iner, sonra anchor'ın hazinesine gönderilir ve anchor TRY'yi IBAN'ınıza öder. İki imza istenir.",
  },
  "wd.cta": { en: "Withdraw from the vault", tr: "Kasadan çek" },
  "wd.ctaBank": { en: "Withdraw and send as TRY", tr: "Çek ve TRY olarak gönder" },
  "wd.receipt": { en: "{amount} USDC withdrawn to your wallet. Transaction: {hash}…", tr: "{amount} USDC cüzdanınıza çekildi. İşlem: {hash}…" },
  "wd.receiptBank": { en: " The anchor sent {amount} TRY to your IBAN.", tr: " Anchor {amount} TRY'yi IBAN'ınıza gönderdi." },

  // ---- how it works ----
  "how.title": { en: "How it works", tr: "Nasıl çalışıyor" },
  "how.p1": {
    en: "Fiat never enters the contract. Lira comes in and goes out through the anchor's corporate IBAN; the contract only holds the USDC pool and the shares.",
    tr: "Fiat hiç kontrata girmez. TL, anchor'ın kurumsal IBAN'ı üzerinden girer ve çıkar; kontrat yalnızca USDC havuzunu ve payları tutar.",
  },
  "how.p2": {
    en: "Every USDC that reaches the vault without minting a share (a withdrawal fee, a yield distribution) raises the value of the existing shares. That is why the share price only goes up.",
    tr: "Kasaya gelen her USDC, pay basılmadan geldiğinde (çıkış komisyonu, getiri dağıtımı) mevcut payların değerini yükseltir. Pay fiyatı bu yüzden yalnızca artar.",
  },
  "how.p3Prefix": { en: "Your share is a SEP-41 token called ", tr: "Payınız " },
  "how.p3Suffix": {
    en: ". It can be transferred, approved for a spender, and shows up in the wallet — just like an LP token on any other network. Whoever you send the share to gets the claim on the vault along with it.",
    tr: " adlı bir SEP-41 token. Transfer edilebilir, bir başkasına yetki verilebilir, cüzdanda görünür — başka ağlardaki LP token'ları gibi. Payı kime gönderirseniz kasadaki hak da onunla birlikte gider.",
  },
  "how.p4": {
    en: "Withdrawals can never be halted — not even while deposits are paused.",
    tr: "Çekimler hiçbir koşulda durdurulamaz — yatırımlar duraklatılsa bile.",
  },
  "how.depositCap": { en: " The deposit cap is {amount} USDC.", tr: " Mevduat tavanı {amount} USDC." },

  // ---- pool activity ----
  "act.title": { en: "Pool activity", tr: "Havuz hareketleri" },
  "act.source": { en: "From the contract's events · as far back as the RPC window", tr: "Kontratın event'lerinden · RPC penceresi kadar geriye" },
  "act.empty": {
    en: "No activity in this window. It appears here as soon as the first deposit is made.",
    tr: "Bu pencerede hareket yok. İlk yatırma yapıldığında burada görünür.",
  },
  "act.fee": { en: "fee {amount}", tr: "komisyon {amount}" },
  "act.deposited": { en: "Deposit", tr: "Yatırma" },
  "act.withdrawn": { en: "Withdrawal", tr: "Çekme" },
  "act.donated": { en: "Yield distribution", tr: "Getiri dağıtımı" },
  "act.advanced": { en: "Advance paid", tr: "Önden ödeme" },
  "act.repaid": { en: "Advance repaid", tr: "Avans geri ödeme" },
  "act.written_off": { en: "Written off", tr: "Batık yazıldı" },

  // ---- anchor activity ----
  "aa.title": { en: "Your anchor transactions", tr: "Anchor işlemleriniz" },
  "aa.needAuth": {
    en: "Reading your anchor records needs one wallet signature. The signature only proves who you are; no money moves.",
    tr: "Anchor kayıtlarınızı okumak için bir kez cüzdan imzası gerekiyor. İmza yalnızca kimliğinizi kanıtlar; hiçbir para hareket etmez.",
  },
  "aa.show": { en: "Show my anchor transactions", tr: "Anchor işlemlerimi göster" },
  "aa.empty": { en: "You have no lira in/out through the anchor yet.", tr: "Anchor üzerinden henüz bir TL giriş/çıkışınız yok." },
  "aa.stuck": {
    en: "One of your transactions is waiting for a USDC trustline. The moment you open it the anchor picks up where it left off — the money is not lost.",
    tr: "Bir işleminiz USDC trustline bekliyor. Açtığınız anda anchor kaldığı yerden devam eder — para kaybolmadı.",
  },
  "aa.openTrustline": { en: "Open the USDC trustline", tr: "USDC trustline'ı aç" },
  "aa.st.completed": { en: "Completed", tr: "Tamamlandı" },
  "aa.st.pending_anchor": { en: "Anchor working", tr: "Anchor işliyor" },
  "aa.st.pending_stellar": { en: "Submitting to network", tr: "Ağa gönderiliyor" },
  "aa.st.pending_trust": { en: "Waiting for USDC trustline", tr: "USDC trustline bekleniyor" },
  "aa.st.pending_user_transfer_start": { en: "Waiting for your money", tr: "Paranız bekleniyor" },
  "aa.st.pending_user_transfer_complete": { en: "Transfer received", tr: "Transfer alındı" },
  "aa.st.incomplete": { en: "Incomplete", tr: "Tamamlanmadı" },
  "aa.st.error": { en: "Error", tr: "Hata" },
  "aa.st.refunded": { en: "Refunded", tr: "İade edildi" },
  "aa.st.expired": { en: "Expired", tr: "Süresi doldu" },

  // ---- pool info ----
  "pi.utilization": { en: "Liquidity utilization", tr: "Likidite kullanımı" },
  "pi.utilizationNote": { en: "{advanced} USDC fronted, {liquid} USDC on hand", tr: "{advanced} USDC önden verilmiş, {liquid} USDC hazırda" },
  "pi.staked": { en: "Staked shares", tr: "Stake edilmiş pay" },
  "pi.stakedNote": {
    en: "There is no staking mechanism; yield is written straight into the share price.",
    tr: "Stake mekanizması yok; getiri doğrudan pay fiyatına yazılır.",
  },
  "pi.composition": { en: "Composition", tr: "Bileşim" },
  "pi.asset": { en: "Asset", tr: "Varlık" },
  "pi.ratio": { en: "Share", tr: "Oran" },
  "pi.amount": { en: "Amount", tr: "Tutar" },
  "pi.onHand": { en: "· on hand", tr: "· hazırda" },
  "pi.fronted": { en: "· fronted", tr: "· önden verilmiş" },
  "pi.total": { en: "Total", tr: "Toplam" },
  "pi.volumeEarnings": { en: "Volume and earnings", tr: "Hacim ve kazanç" },
  "pi.volume": { en: "Traded volume ({window})", tr: "İşlem hacmi ({window})" },
  "pi.windowTracked": { en: "in the tracked window", tr: "izlenen pencerede" },
  "pi.windowHours": { en: "in the last {h} hours", tr: "son {h} saatte" },
  "pi.depWit": { en: "· deposits / withdrawals", tr: "· yatırma / çekme" },
  "pi.withdrawFeesEarned": { en: "Withdrawal fees earned", tr: "Kazanılan çıkış komisyonu" },
  "pi.advanceFeesEarned": { en: "Advance fees earned", tr: "Kazanılan avans komisyonu" },
  "pi.advancesOpened": { en: "Advances opened", tr: "Açılan avans" },
  "pi.writtenOff": { en: "Written off", tr: "Batık yazılan" },
  "pi.yieldSources": { en: "Yield sources", tr: "Getiri kaynakları" },
  "pi.measuredApr": { en: "Measured annual yield", tr: "Ölçülen yıllık getiri" },
  "pi.notEnoughHistory": { en: "not enough history", tr: "yeterli geçmiş yok" },
  "pi.advanceFee": { en: "Advance fee", tr: "Avans komisyonu" },
  "pi.distribution": { en: "Distribution", tr: "Dağıtım" },
  "pi.distributionValue": { en: "USDC arriving without minting shares → share price", tr: "pay basılmadan gelen USDC → pay fiyatı" },
  "pi.contracts": { en: "Contracts", tr: "Kontratlar" },
  "pi.vaultShareToken": { en: "Vault / share token", tr: "Kasa / pay token'ı" },
  "pi.usdcSac": { en: "USDC (SAC)", tr: "USDC (SAC)" },
  "pi.admin": { en: "Admin", tr: "Yönetici" },
  "pi.relay": { en: "Advance relay", tr: "Avans relay'i" },
  "pi.priceSource": { en: "Price source", tr: "Fiyat kaynağı" },
  "pi.priceSourceValue": { en: "anchor SEP-38 · Reflector", tr: "anchor SEP-38 · Reflector" },
  "pi.network": { en: "Network", tr: "Ağ" },
  "pi.networkValue": { en: "Stellar testnet", tr: "Stellar testnet" },
  "pi.parameters": { en: "Parameters", tr: "Parametreler" },
  "pi.poolType": { en: "Pool type", tr: "Havuz tipi" },
  "pi.poolTypeValue": { en: "single-asset, share-accounted vault", tr: "tek varlıklı, pay muhasebeli kasa" },
  "pi.shareToken": { en: "Share token", tr: "Pay token'ı" },
  "pi.decimals": { en: "7 decimals", tr: "7 hane" },
  "pi.circulating": { en: "Shares outstanding", tr: "Dolaşımdaki pay" },
  "pi.depositCap": { en: "Deposit cap", tr: "Mevduat tavanı" },
  "pi.unlimited": { en: "unlimited", tr: "sınırsız" },
  "pi.maxAdvance": { en: "Single advance limit", tr: "Tek avans limiti" },
  "pi.advanceCap": { en: "Total advance cap", tr: "Toplam avans tavanı" },
  "pi.off": { en: "off", tr: "kapalı" },
  "pi.deposits": { en: "Deposits", tr: "Yatırımlar" },
  "pi.paused": { en: "paused", tr: "durduruldu" },
  "pi.open": { en: "open", tr: "açık" },
  "pi.withdrawals": { en: "Withdrawals", tr: "Çekimler" },
  "pi.alwaysOpen": { en: "always open", tr: "her koşulda açık" },
  "pi.risks": { en: "Risks", tr: "Riskler" },
  "pi.risk1Head": { en: "Advances are unsecured.", tr: "Avanslar teminatsız." },
  "pi.risk1Body": {
    en: " The vault pays before the anchor delivers and cannot force repayment on-chain. A bad advance is written off with write_off and the loss lands directly on the share price. That is why the limits are kept small.",
    tr: " Kasa, anchor teslim etmeden önce ödeme yapar ve geri ödemeyi zincir üzerinde zorlayamaz. Batık bir avans write_off ile yazılır ve zarar doğrudan pay fiyatına düşer. Limitler bu yüzden küçük tutuluyor.",
  },
  "pi.risk2Head": { en: "The relay is a trusted component.", tr: "Relay güvenilen bir bileşen." },
  "pi.risk2Body": {
    en: " It is the only party allowed to open an advance. It cannot move the pool's money anywhere else, but it decides who gets an advance.",
    tr: " Avansı açmaya yetkili tek taraf o. Havuzun parasını başka bir yere taşıyamaz, ama kimin avans alacağına o karar verir.",
  },
  "pi.risk3Head": { en: "The admin can change the fee and the caps", tr: "Yönetici komisyonu ve tavanı değiştirebilir" },
  "pi.risk3Body": {
    en: " (the withdrawal fee at most 5%) and can pause deposits. It cannot pause withdrawals.",
    tr: " (çıkış komisyonu en fazla %5) ve yatırımları durdurabilir. Çekimleri durduramaz.",
  },
  "pi.risk4Head": { en: "Withdrawals can queue while utilization is high.", tr: "Likidite kullanımı yüksekken çekim beklemeli olabilir." },
  "pi.risk4Body": {
    en: " A withdrawal is only paid from USDC on hand; once the advances come back, the rest can be withdrawn too.",
    tr: " Çekim yalnızca hazırdaki USDC'den ödenir; avanslar geri gelince kalan da çekilebilir.",
  },
  "pi.risk5Head": { en: "The fiat leg depends on the anchor.", tr: "Fiat tarafı anchor'a bağlı." },
  "pi.risk5Body": {
    en: " Lira in and out runs on the anchor's rails; if the anchor stalls, the lira leg stalls.",
    tr: " TL girişi ve çıkışı anchor'ın rayları üzerinden yürür; anchor duraksarsa TL bacağı duraksar.",
  },
  "pi.risk6Head": { en: "Testnet.", tr: "Testnet." },
  "pi.risk6Body": {
    en: " No real money moves and the contract has not been audited.",
    tr: " Gerçek para hareket etmiyor, kontrat denetlenmedi.",
  },

  // ---- vault / chain errors ----
  "err.2": { en: "The vault has not been set up yet.", tr: "Kasa henüz kurulmamış." },
  "err.3": { en: "Deposits are paused for now. Withdrawals are open.", tr: "Yatırımlar geçici olarak durduruldu. Çekimler açık." },
  "err.20": { en: "Invalid amount.", tr: "Geçersiz tutar." },
  "err.21": { en: "The first deposit must be at least 1 USDC.", tr: "İlk yatırım en az 1 USDC olmalı." },
  "err.22": { en: "This amount is too small to produce any shares.", tr: "Bu tutar pay üretmeyecek kadar küçük." },
  "err.23": { en: "You do not hold that many shares.", tr: "Bu kadar payınız yok." },
  "err.24": { en: "The payout for that many shares rounds to zero.", tr: "Bu kadar pay için ödenecek tutar sıfıra yuvarlanıyor." },
  "err.30": { en: "Invalid fee rate.", tr: "Geçersiz komisyon oranı." },
  "err.31": { en: "The vault has reached its deposit cap.", tr: "Kasa mevduat tavanına ulaştı." },
  "err.50": { en: "Insufficient allowance.", tr: "Yetki (allowance) yetersiz." },
  "err.52": { en: "Your share balance is insufficient.", tr: "Pay bakiyeniz yetersiz." },
  "err.60": { en: "The vault is not fronting money right now.", tr: "Kasa şu an önden ödeme yapmıyor." },
  "err.61": { en: "The amount is above the single-advance limit.", tr: "Tutar tek seferlik avans limitinin üstünde." },
  "err.62": { en: "The vault's total advance capacity is full.", tr: "Kasanın toplam avans kapasitesi dolu." },
  "err.63": { en: "This account already has an open advance.", tr: "Bu hesabın kapatılmamış bir avansı var." },
  "err.64": { en: "There is no open advance.", tr: "Açık bir avans yok." },
  "err.65": { en: "The vault does not have enough liquid USDC right now.", tr: "Kasada şu an yeterli likit USDC yok." },
  "err.40": { en: "Arithmetic error.", tr: "Hesaplama hatası." },
  "err.unknownCode": { en: "Vault error #{code}", tr: "Kasa hatası #{code}" },
  "err.failed": { en: "Transaction failed: {detail}", tr: "İşlem başarısız: {detail}" },
  "err.tx_insufficient_balance": {
    en: "Your wallet does not have enough XLM for the transaction fee.",
    tr: "Cüzdanınızda işlem ücreti için yeterli XLM yok.",
  },
  "err.op_underfunded": { en: "Your USDC balance is not enough for this amount.", tr: "USDC bakiyeniz bu tutar için yetersiz." },
  "err.op_no_trust": { en: "You have no USDC trustline.", tr: "USDC trustline'ınız yok." },
  "err.tx_bad_seq": { en: "The wallet sequence did not match. Refresh the page.", tr: "Cüzdan sırası eşleşmedi. Sayfayı yenileyin." },
  "err.tx_too_late": { en: "The transaction timed out.", tr: "İşlem zaman aşımına uğradı." },
  "err.notConfirmed": { en: "The transaction was not confirmed within 40 seconds.", tr: "İşlem 40 saniyede onaylanmadı." },

  // ---- anchor / network errors ----
  "err.anchorStatus": { en: "The anchor returned {status}", tr: "Anchor {status} döndürdü" },
  "err.anchorFailed": { en: "The anchor transaction failed.", tr: "Anchor işlemi başarısız oldu." },
  "err.anchorTimeout": {
    en: "The anchor did not finish within 10 minutes. The transaction was not cancelled — it is still pending on the anchor's side.",
    tr: "Anchor 10 dakikada tamamlamadı. İşlem iptal olmadı — anchor tarafında beklemeye devam ediyor.",
  },
  "err.anchorNoId": { en: "The anchor did not return a transaction id.", tr: "Anchor bir işlem numarası döndürmedi." },
  "err.anchorNoTreasury": { en: "The anchor did not return a treasury address or memo.", tr: "Anchor hazine adresi veya memo döndürmedi." },
  "err.sessionInvalid": {
    en: "The anchor session is invalid. Disconnect the wallet and connect again.",
    tr: "Anchor oturumu geçersiz. Cüzdanı ayırıp yeniden bağlanın.",
  },
  "err.challengeFailed": { en: "Could not get the anchor challenge", tr: "Anchor challenge alınamadı" },
  "err.wrongNetwork": { en: "The anchor sent a challenge for a different network", tr: "Anchor farklı bir ağ için challenge gönderdi" },
  "err.badSequence": { en: "Invalid challenge: the sequence must be 0", tr: "Challenge geçersiz: sequence 0 olmalı" },
  "err.authRejected": { en: "The anchor rejected the authentication", tr: "Anchor kimlik doğrulamasını reddetti" },
  "err.sep12Failed": { en: "SEP-12 registration failed", tr: "SEP-12 kaydı başarısız" },
  "err.sep12Read": { en: "Could not read the SEP-12 status", tr: "SEP-12 durumu okunamadı" },
  "err.priceFailed": { en: "Could not get the anchor price", tr: "Anchor fiyatı alınamadı" },
  "err.friendbot": { en: "Friendbot could not fund the account ({status})", tr: "Friendbot hesabı fonlayamadı ({status})" },
  "err.relayUnreachable": { en: "The instant-payout service is unreachable.", tr: "Anında ödeme servisine ulaşılamıyor." },
  "err.relayStatus": { en: "Relay error {status}", tr: "Relay hatası {status}" },

  // ---- IBAN ----
  "iban.mustStartTr": { en: "An IBAN must start with TR.", tr: "IBAN TR ile başlamalı." },
  "iban.digitsOnly": { en: "After TR, an IBAN may only contain digits.", tr: "IBAN, TR'den sonra yalnızca rakam içermeli." },
  "iban.wrongLength": { en: "There must be 24 digits after TR; you entered {n}.", tr: "TR'den sonra 24 rakam olmalı, {n} girdiniz." },
} satisfies Record<string, Entry>;

export type Key = keyof typeof dict;

/**
 * Translate a key, filling `{placeholders}` from `vars`.
 *
 * Usable outside React too — the library layer produces user-facing error
 * messages and has no hooks available.
 */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const entry = dict[key] as Entry | undefined;
  let out = entry ? entry[current] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}

/** `t`, but the component re-renders when the language changes. */
export function useT(): typeof t {
  useLang();
  return t;
}
