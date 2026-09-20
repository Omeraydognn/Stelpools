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
  "app.skipToContent": { en: "Skip to content", tr: "İçeriğe geç" },
  "nav.label": { en: "Main menu", tr: "Ana menü" },
  "wallet.connect": { en: "Connect wallet", tr: "Cüzdan bağla" },
  "wallet.connecting": { en: "Connecting…", tr: "Bağlanıyor…" },
  "wallet.disconnect": { en: "Disconnect", tr: "Çıkış" },
  "wallet.yourAddress": { en: "Your wallet address", tr: "Cüzdan adresiniz" },
  "wallet.copyHint": { en: "click to copy", tr: "kopyalamak için tıklayın" },
  "wallet.rejected": { en: "Wallet connection cancelled", tr: "Cüzdan bağlantısı iptal edildi" },

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
  "about.p1": {
    en: "The fiat (TRY) leg belongs to the anchor: every lira in and out moves through its corporate IBAN over SEP-6. The crypto (USDC) leg belongs to the Soroban vault: it pools the incoming USDC and keeps everyone's share.",
    tr: "Fiat (TRY) tarafının sorumlusu Mock Anchor'dır: tüm TL giriş ve çıkışları onun kurumsal IBAN'ı üzerinden, SEP-6 ile yürür. Kripto (USDC) tarafının sorumlusu Soroban kasasıdır: gelen USDC'yi havuzda toplar ve herkesin payını tutar.",
  },
  "about.p2": {
    en: "Wallets pass through SEP-10 and SEP-12 in the background before a transaction. The pool's rate always comes from the anchor's SEP-38 pricing.",
    tr: "Cüzdanlar işlemden önce arka planda SEP-10 ve SEP-12'den geçer. Havuzun kuru daima anchor'ın SEP-38 fiyatlamasından beslenir.",
  },

  // ---- configuration ----
  "config.usingDefaults": {
    en: "Environment variables not set: {names}. The app is running on the public testnet defaults.",
    tr: "Tanımlı olmayan ortam değişkenleri: {names}. Uygulama herkese açık testnet varsayılanlarıyla çalışıyor.",
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
  "ui.connectFirst": { en: "Connect a wallet first", tr: "Önce cüzdan bağlayın" },

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

  // ---- pool header ----

  "pool.contract": { en: "Contract", tr: "Kontrat" },

  // ---- position ----
  "position.connect": {
    en: "Connect your wallet to see your position.",
    tr: "Pozisyonunuzu görmek için cüzdanınızı bağlayın.",
  },

  // ---- tabs ----
  "tab.group": { en: "Action", tr: "İşlem" },
  "tab.swap": { en: "Swap", tr: "Takas" },

  // ---- swap ----
  "swap.flip": { en: "Flip direction", tr: "Yönü çevir" },

  "swap.ibanLabel": { en: "IBAN to receive the TRY", tr: "TRY'yi alacağınız IBAN" },
  "swap.bankLabel": { en: "Bank name", tr: "Banka adı" },
  "swap.bankPlaceholder": { en: "e.g. Akbank", tr: "Örn. Akbank" },

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

  // ---- pool page ----
  "pool2.tagline": {
    en: "One pool, two tokens, and a price that is nothing more than the ratio between them.",
    tr: "Tek havuz, iki token, ve aralarındaki orandan başka bir şey olmayan bir fiyat.",
  },
  "pool2.rate": { en: "1 USDC buys", tr: "1 USDC alır" },
  "pool2.usdcSide": { en: "USDC in the pool", tr: "Havuzdaki USDC" },
  "pool2.atrySide": { en: "aTRY in the pool", tr: "Havuzdaki aTRY" },
  "pool2.fee": { en: "Swap fee", tr: "Takas komisyonu" },
  "pool2.lpTokens": { en: "LP tokens", tr: "LP token" },
  "pool2.yourPosition": { en: "Your position", tr: "Pozisyonunuz" },
  "pool2.lpHeld": { en: "LP tokens held", tr: "Tuttuğunuz LP" },
  "pool2.yourUsdc": { en: "Your USDC in it", tr: "İçindeki USDC'niz" },
  "pool2.yourAtry": { en: "Your aTRY in it", tr: "İçindeki aTRY'niz" },
  "pool2.shareOfPool": { en: "Share of the pool", tr: "Havuzdaki payınız" },
  "pool2.walletTitle": { en: "Your wallet", tr: "Cüzdanınız" },
  "pool2.liquidity": { en: "Liquidity", tr: "Likidite" },
  "pool2.contracts": { en: "On-chain addresses", tr: "Zincir üstü adresler" },
  "pool2.poolContract": { en: "Pool contract", tr: "Havuz kontratı" },
  "pool2.atryIssuer": { en: "aTRY issuer", tr: "aTRY ihraççısı" },

  "how2.title": { en: "How it works", tr: "Nasıl çalışıyor" },
  "how2.p1": {
    en: "The anchor is the only part that touches a bank. Send it lira and it issues {code} to your wallet, one for one — no rate, nothing to quote.",
    tr: "Bankaya dokunan tek parça anchor'dır. Ona lira gönderirsiniz, cüzdanınıza birebir {code} basar — kur yok, kotasyon yok.",
  },
  "how2.p2": {
    en: "The pool is the only part that touches a price, and it does not quote one either: the rate is the ratio of the two reserves, and it moves only because somebody traded.",
    tr: "Fiyata dokunan tek parça havuzdur, o da fiyat vermez: kur iki rezervin oranıdır ve yalnızca biri işlem yaptığı için hareket eder.",
  },
  "how2.p3": {
    en: "Every swap leaves {fee} of its input behind in the reserves. That is the whole of a provider's return, and it is why the product of the reserves only grows.",
    tr: "Her takas, girdisinin {fee} kadarını rezervlerde bırakır. Likidite sağlayanın getirisi tamamen budur ve rezervlerin çarpımının yalnızca büyümesinin sebebi de odur.",
  },
  "how2.p4": {
    en: "There is no admin on the pool contract. No pause switch, no fee setter, no allowlist — after it was deployed, nobody can change how it behaves, including us.",
    tr: "Havuz kontratında yönetici yok. Durdurma düğmesi yok, komisyon ayarı yok, izin listesi yok — deploy edildikten sonra davranışını kimse değiştiremez, biz dâhil.",
  },

  // ---- fiat ramp (our own anchor) ----
  "ramp2.group": { en: "Turkish lira", tr: "Türk lirası" },
  "ramp2.deposit": { en: "Bring lira in", tr: "TL yatır" },
  "ramp2.withdraw": { en: "Take lira out", tr: "TL çek" },
  "ramp2.sendFromBank": { en: "Send from your bank", tr: "Bankanızdan göndereceğiniz" },
  "ramp2.oneForOne": {
    en: "One {code} is one lira. No rate, no spread — the exchange happens next door, in the pool.",
    tr: "Bir {code} bir liradır. Kur yok, spread yok — döviz işlemi yan tarafta, havuzda oluyor.",
  },
  "ramp2.needTrustline": {
    en: "Your wallet has not agreed to hold {code} yet, so the anchor cannot deliver it.",
    tr: "Cüzdanınız henüz {code} tutmayı kabul etmemiş, bu yüzden anchor gönderemez.",
  },
  "ramp2.acceptAtry": { en: "Accept {code}", tr: "{code} tanımla" },
  "ramp2.step1": {
    en: "1. The anchor verifies you and gives you its IBAN plus a reference code",
    tr: "1. Anchor kimliğinizi doğrular ve size IBAN'ını + bir referans kodu verir",
  },
  "ramp2.step2": {
    en: "2. You send the lira from your own bank, with that code in the description",
    tr: "2. Lirayı kendi bankanızdan, açıklamaya o kodu yazarak gönderirsiniz",
  },
  "ramp2.step3": {
    en: "3. When the money arrives the anchor issues {code} to your wallet, one for one",
    tr: "3. Para gelince anchor cüzdanınıza birebir {code} basar",
  },
  "ramp2.getIban": { en: "Get the transfer details", tr: "Havale bilgilerini al" },
  "ramp2.received": { en: "{amount} {code} is in your wallet.", tr: "{amount} {code} cüzdanınıza geçti." },
  "ramp2.sendBack": { en: "Send back", tr: "Geri göndereceğiniz" },
  "ramp2.burnNote": {
    en: "Your {code} goes back to the issuer, which destroys it — that is what returning an asset to its issuer does on Stellar. The lira then goes to your IBAN.",
    tr: "{code}'niz ihraççıya geri gider ve yok olur — Stellar'da bir varlığı ihraççısına göndermek onu yakar. Lira da IBAN'ınıza geçer.",
  },
  "ramp2.withdrawCta": { en: "Withdraw as lira", tr: "Lira olarak çek" },
  "ramp2.paidOut": { en: "The anchor sent {amount} TRY to your IBAN.", tr: "Anchor {amount} TRY'yi IBAN'ınıza gönderdi." },

  // ---- AMM swap ----
  "swap2.youPay": { en: "You pay", tr: "Ödeyeceğiniz" },
  "swap2.youReceive": { en: "You receive", tr: "Alacağınız" },
  "swap2.quoting": { en: "Asking the pool…", tr: "Havuza soruluyor…" },
  "swap2.rate": { en: "Rate", tr: "Kur" },
  "swap2.priceImpact": { en: "Price impact", tr: "Fiyat etkisi" },
  "swap2.fee": { en: "Pool fee", tr: "Havuz komisyonu" },
  "swap2.minReceived": { en: "Minimum received", tr: "En az alacağınız" },
  "swap2.slippage": { en: "Slippage tolerance", tr: "Slippage toleransı" },
  "swap2.balance": { en: "You have {amount} {code}.", tr: "Cüzdanınızda {amount} {code} var." },
  "swap2.overBalance": { en: "You only have {amount} {code}.", tr: "Cüzdanınızda yalnızca {amount} {code} var." },
  "swap2.impact": {
    en: "This trade moves the price by {pct}. The pool is small, so size costs more than the fee — split it into smaller trades if you can.",
    tr: "Bu işlem fiyatı {pct} kaydırıyor. Havuz küçük olduğu için büyüklük komisyondan pahalıya geliyor — mümkünse işlemi parçalara bölün.",
  },
  "swap2.emptyPool": {
    en: "This pool has no liquidity yet, so there is nothing to trade against. Add liquidity first.",
    tr: "Havuzda henüz likidite yok, karşısında işlem yapılacak bir şey bulunmuyor. Önce likidite ekleyin.",
  },
  "swap2.needTrustline": {
    en: "Your wallet has not agreed to hold both tokens yet. On Stellar an account holds nothing it has not opted into.",
    tr: "Cüzdanınız henüz iki token'ı da tutmayı kabul etmemiş. Stellar'da bir hesap, izin vermediği hiçbir varlığı tutamaz.",
  },
  "swap2.addTrustlines": { en: "Accept both tokens", tr: "İki token'ı da tanımla" },
  "swap2.cta": { en: "Swap {from} for {to}", tr: "{from} ver, {to} al" },
  "swap2.receipt": { en: "Swapped {paid} for {got}.", tr: "{paid} verildi, {got} alındı." },
  "swap2.onchain": {
    en: "This swap is a call to the pool contract, signed by your wallet. No server sits in between and the price comes from the reserves alone.",
    tr: "Bu takas, cüzdanınızın imzaladığı bir kontrat çağrısıdır. Arada sunucu yok; fiyat yalnızca havuzdaki rezervlerden gelir.",
  },

  // ---- liquidity ----
  "liq.group": { en: "Liquidity", tr: "Likidite" },
  "liq.add": { en: "Add", tr: "Ekle" },
  "liq.remove": { en: "Remove", tr: "Çıkar" },
  "liq.firstProvider": {
    en: "The pool is empty, so you set its opening price: whatever ratio you deposit is the rate everyone starts from.",
    tr: "Havuz boş, yani açılış fiyatını siz belirliyorsunuz: hangi oranda yatırırsanız herkesin başlayacağı kur o olur.",
  },
  "liq.youSetThePrice": { en: "You choose this, and with it the starting price.", tr: "Bunu siz seçiyorsunuz, başlangıç fiyatı da buradan doğuyor." },
  "liq.ratioDecides": { en: "Set by the pool's current ratio, so your deposit cannot move the price.", tr: "Havuzun mevcut oranından geliyor; yatırımınız fiyatı oynatamaz." },
  "liq.addCta": { en: "Add liquidity", tr: "Likidite ekle" },
  "liq.added": { en: "Added {a} and {b}. You received {shares} LP tokens.", tr: "{a} ve {b} eklendi. {shares} LP token aldınız." },
  "liq.note": {
    en: "LP tokens are a SEP-41 asset: transferable, and the claim on the pool travels with them.",
    tr: "LP token'ları SEP-41 varlığıdır: devredilebilir ve havuzdaki hak da onunla birlikte gider.",
  },
  "liq.sharesToBurn": { en: "LP tokens to burn", tr: "Yakılacak LP token" },
  "liq.youHold": { en: "You hold {amount} {symbol}.", tr: "{amount} {symbol} tutuyorsunuz." },
  "liq.removeCta": { en: "Remove liquidity", tr: "Likidite çıkar" },
  "liq.removed": { en: "Returned {a} and {b}.", tr: "{a} ve {b} geri alındı." },
  "liq.noPosition": { en: "You have no liquidity in this pool yet.", tr: "Bu havuzda henüz likiditeniz yok." },
  "liq.impermanent": {
    en: "You always get back the pool's ratio at the moment you leave, not the one you put in — that difference is impermanent loss. Against it, every trade leaves {fee} behind for you.",
    tr: "Her zaman çıktığınız andaki havuz oranını geri alırsınız, koyduğunuz oranı değil — bu fark impermanent loss'tur. Karşılığında her işlem size {fee} bırakır.",
  },

  // ---- AMM contract errors ----
  "amm.1": { en: "This pool is already set up.", tr: "Bu havuz zaten kurulmuş." },
  "amm.2": { en: "The pool has not been set up yet.", tr: "Havuz henüz kurulmamış." },
  "amm.3": { en: "A pair must be two different tokens.", tr: "Bir çift, iki farklı token olmalı." },
  "amm.4": { en: "Invalid fee.", tr: "Geçersiz komisyon." },
  "amm.20": { en: "Invalid amount.", tr: "Geçersiz tutar." },
  "amm.21": {
    en: "The first deposit is too small to open the pool.",
    tr: "İlk yatırım havuzu açmak için fazla küçük.",
  },
  "amm.22": { en: "Burning that many LP tokens would return nothing.", tr: "Bu kadar LP token hiçbir şey döndürmez." },
  "amm.23": { en: "You do not hold that many LP tokens.", tr: "Bu kadar LP token'ınız yok." },
  "amm.30": {
    en: "The price moved: this swap would return less than your minimum. Try again, or raise your slippage tolerance.",
    tr: "Fiyat hareket etti: bu takas belirlediğiniz alt sınırdan az döndürürdü. Tekrar deneyin veya slippage toleransını yükseltin.",
  },
  "amm.31": {
    en: "The pool's ratio would take less USDC than your minimum.",
    tr: "Havuzun oranı, belirlediğiniz alt sınırdan az USDC alırdı.",
  },
  "amm.32": {
    en: "The pool's ratio would take less aTRY than your minimum.",
    tr: "Havuzun oranı, belirlediğiniz alt sınırdan az aTRY alırdı.",
  },
  "amm.33": {
    en: "The pool does not have enough liquidity for this trade.",
    tr: "Havuzda bu işlem için yeterli likidite yok.",
  },
  "amm.34": { en: "That token is not in this pair.", tr: "Bu token bu çiftte yok." },
  "amm.40": { en: "Arithmetic error.", tr: "Hesaplama hatası." },
  "amm.50": { en: "Insufficient allowance.", tr: "Yetki (allowance) yetersiz." },
  "amm.51": { en: "The allowance would already be expired.", tr: "Yetkinin süresi şimdiden dolmuş olurdu." },
  "amm.52": { en: "Your LP balance is insufficient.", tr: "LP bakiyeniz yetersiz." },

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
