import { useState } from 'react';
import { useT } from '../lib/i18n';
import { explorerContract } from '../lib/amm';
import type { View } from './Header';
import { useCopy } from '../lib/useCopy';

function Arrow() { return <span aria-hidden="true">↗</span>; }
export function Action({ children, href = '#/vault', light = false }: { children: React.ReactNode; href?: string; light?: boolean }) {
  return <a className={`action-link ${light ? 'action-light' : ''}`} href={href}>{children}<Arrow /></a>;
}

function LineArt({ kind }: { kind: 'bridge' | 'shield' | 'wallet' }) {
  return <svg className="line-art" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    {kind === 'shield' ? <><path d="M50 9 81 22v24c0 23-31 43-31 43S19 69 19 46V22L50 9Z" fill="var(--lime)"/><path d="m50 17 24 10v19c0 17-24 35-24 35S26 63 26 46V27l24-10Z" stroke="currentColor"/><path d="m37 47 9 9 18-20" stroke="currentColor" strokeWidth="3"/></> : kind === 'wallet' ? <><rect x="12" y="27" width="75" height="53" rx="5" fill="var(--lime)"/><path d="m19 27 51-15v15M12 40h75v39H12V27h75v13M66 49h24v20H66z" stroke="currentColor" strokeWidth="2"/><circle cx="74" cy="59" r="2" fill="currentColor"/></> : <><circle cx="28" cy="50" r="23" fill="var(--lime)"/><circle cx="72" cy="50" r="23" stroke="currentColor" strokeWidth="2"/><path d="M23 40h52l-8-8M77 60H25l8 8M28 27v46" stroke="currentColor" strokeWidth="2"/></>}
  </svg>;
}

function TransferVisual() {
  const c = useCopy();
  return <div className="transfer-visual" aria-label={c('Illustration of a TRY to USDC transfer', 'TRY ile USDC arasında transfer illüstrasyonu')}>
    <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
    <span className="floating-coin coin-try" aria-hidden="true">₺</span><span className="floating-coin coin-usdc" aria-hidden="true">$</span>
    <div className="product-window">
      <div className="window-top"><img src="/logo-dark-bg.png" alt="" width="110" height="27"/><span className="network-label">STELLAR TESTNET</span></div>
      <div className="preview-tabs"><span>{c('Buy crypto', 'Kripto al')}</span><span>{c('Sell crypto', 'Kripto sat')}</span></div>
      <div className="preview-field"><span>{c('You send', 'Gönderdiğiniz')}</span><div><strong>1.000</strong><b><i className="currency-dot">₺</i>TRY</b></div><small>{c('From your bank account', 'Banka hesabınızdan')}</small></div>
      <div className="transfer-arrow" aria-hidden="true">↓</div>
      <div className="preview-field"><span>{c('You receive', 'Aldığınız')}</span><div><strong>USDC</strong><b><i className="currency-dot usdc-dot">$</i>USDC</b></div><small>{c('Directly to your Stellar wallet', 'Doğrudan Stellar cüzdanınıza')}</small></div>
      <div className="preview-button">{c('Your bank. Your wallet.', 'Sizin bankanız. Sizin cüzdanınız.')} <span aria-hidden>↗</span></div>
      <p className="preview-caption">{c('Illustrative preview · not a live quote', 'Örnek görünüm · canlı fiyat değildir')}</p>
    </div>
    <div className="settlement-tag"><span className="status-dot"/>{c('Connected by Stellar', 'Stellar ile birbirine bağlı')}<span aria-hidden>↗</span></div>
  </div>;
}

export function Steps() {
  const c = useCopy();
  const steps = [
    [c('Connect your wallet', 'Cüzdanınızı bağlayın'), c('Choose your Stellar wallet. Your keys stay with you.', 'Stellar cüzdanınızı seçin. Anahtarlarınız sizde kalır.')],
    [c('Choose your direction', 'İşleminizi seçin'), c('Move between TRY and USDC, or provide liquidity to the pool.', 'TRY ile USDC arasında geçiş yapın veya havuza likidite ekleyin.')],
    [c('Review. Confirm. Done.', 'Kontrol edin. Onaylayın.'), c('Check the details and follow your transfer on-chain.', 'İşlem detaylarını kontrol edin ve transferinizi zincir üzerinde takip edin.')],
  ];
  return <div className="steps">{steps.map(([title, body], i) => <article key={title}><span className="step-number">0{i + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div>;
}

export function Home() {
  const c = useCopy();
  return <>
    <section className="hero"><div className="shell hero-grid"><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/>{c('YOUR BRIDGE TO ON-CHAIN FINANCE', 'ZİNCİR ÜSTÜ FİNANSA AÇILAN KAPINIZ')}</div><h1><mark>{c('Your money.', 'Sizin paranız.')}</mark><br/>{c('More possibilities.', 'Daha fazla olanak.')}</h1><p>{c('From Turkish lira to digital dollars. Buy, sell and put your USDC to work — all in one place, on Stellar.', 'Türk lirasından dijital dolara. USDC alın, satın ve havuza likidite sağlayın. Hepsi tek bir yerde, Stellar üzerinde.')}</p><div className="hero-actions"><Action light>{c('Get started', 'Hemen başlayın')}</Action><a className="text-link" href="#/learn">{c('Discover Stelpools', 'Stelpools’u keşfedin')} <Arrow/></a></div><div className="hero-note"><span>STELLAR</span><span>USDC</span><span>{c('Self-custody', 'Kişisel cüzdan')}</span></div></div><TransferVisual/></div></section>
    <div className="network-strip"><div className="shell"><span>{c('Local money. Open possibilities.', 'Yerel para. Yeni olanaklar.')}</span><span>TRY <i aria-hidden>↔</i> USDC</span><span>{c('Built on', 'Altyapı')} <strong>Stellar ↗</strong></span><span className="testnet-chip">{c('Testnet preview', 'Testnet önizleme')}</span></div></div>
    <section className="section shell"><div className="section-heading"><h2>{c('A simpler way to', 'Paranız için')}<br/><em>{c('move your money.', 'daha kolay bir yol.')}</em></h2><p>{c('The familiarity of your bank. The flexibility of USDC. One seamless connection.', 'Bankanızın tanıdık deneyimi. USDC’nin esnekliği. Tek bir bağlantıda.')}</p></div><div className="feature-grid">{([
      ['bridge', c('From lira to USDC', 'Liradan USDC’ye'), c('Send TRY through the anchor’s bank transfer flow and receive USDC in your Stellar wallet.', 'Anchor banka transferi akışıyla TRY gönderin, Stellar cüzdanınıza USDC alın.')],
      ['wallet', c('Put liquidity to work', 'Likiditeye katkı sağlayın'), c('Deposit USDC into the vault. Pool fees are reflected in the value of your shares.', 'Kasaya USDC yatırın. Havuz ücretleri, sahip olduğunuz payların değerine yansısın.')],
      ['shield', c('See every movement', 'Her işlemi takip edin'), c('View pool balances, share prices and transactions directly on Stellar.', 'Havuz bakiyelerini, pay fiyatlarını ve işlemleri doğrudan Stellar üzerinde inceleyin.')],
    ] as const).map(([kind, title, body]) => <article key={kind}><LineArt kind={kind}/><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="earn-section"><div className="shell earn-grid"><div className="pool-art" aria-hidden="true"><div className="pool-orbit"/><div className="coin-stack"><span/><span/><span/><span/><span>$</span></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span><span className="pool-art-caption">USDC / STELLAR</span></div><div><span className="eyebrow">STELPOOLS EARN</span><h2>{c('Your USDC.', 'Sizin USDC’niz.')}<br/><mark>{c('In good company.', 'Ortak bir havuz.')}</mark></h2><p>{c('Be part of the liquidity behind the exchange. Deposit USDC, receive pool shares and track your position with transparent on-chain data.', 'Dönüşümün arkasındaki likiditeye katılın. USDC yatırın, havuz payı alın ve pozisyonunuzu şeffaf zincir üstü verilerle takip edin.')}</p><Action href="#/vault/deposit">{c('Explore the pool', 'Havuzu keşfedin')}</Action><small>{c('Returns vary. Smart-contract, liquidity and anchor risks apply.', 'Getiri değişkendir. Akıllı kontrat, likidite ve anchor riskleri bulunur.')}</small></div></div></section>
    <section className="section shell"><div className="section-heading"><h2><em>{c('Three steps.', 'Üç adım.')}</em><br/>{c('A world of possibilities.', 'Yepyeni olanaklar.')}</h2><Action>{c('Let’s get started', 'Birlikte başlayalım')}</Action></div><Steps/></section>
    <section className="closing"><div className="shell"><h2>{c('Make your next move.', 'Bir sonraki adımı atın.')}</h2><Action light>{c('Explore Stelpools', 'Stelpools’u keşfedin')}</Action></div></section>
  </>;
}

const questions = [
  ['What is Stelpools?', 'Stelpools nedir?', 'Stelpools connects TRY bank transfers to USDC on Stellar through an anchor, with a USDC vault for liquidity providers.', 'Stelpools, bir anchor üzerinden TRY banka transferlerini Stellar üzerindeki USDC’ye bağlar ve likidite sağlayıcıları için USDC kasası sunar.'],
  ['Do I need a wallet?', 'Cüzdana ihtiyacım var mı?', 'Yes. Connect a supported Stellar wallet. Your account needs a USDC trustline; the app guides you through any missing requirements.', 'Evet. Desteklenen bir Stellar cüzdanı bağlayın. Hesabınızda USDC trustline bulunmalıdır; uygulama eksik gereksinimler için sizi yönlendirir.'],
  ['How do TRY transfers work?', 'TRY transferleri nasıl çalışır?', 'The anchor provides bank transfer instructions and confirms settlement. Always use the account and reference shown for your specific transfer.', 'Anchor, banka transferi talimatlarını sağlar ve ödemenin tamamlandığını doğrular. Her işlem için gösterilen hesap ve açıklama bilgisini kullanın.'],
  ['Where does pool yield come from?', 'Havuz getirisi nereden gelir?', 'Withdrawal fees and supported advance fees accrue to the pool and affect share value. Returns depend on actual activity and are not guaranteed.', 'Çekim ücretleri ve desteklenen avans ücretleri havuza yansır ve pay değerini etkiler. Getiri gerçek işlem etkinliğine bağlıdır ve garanti edilmez.'],
  ['Can I withdraw whenever I want?', 'İstediğim zaman çekim yapabilir miyim?', 'Withdrawals depend on available pool liquidity. Review the fee and amount before confirming. TRY withdrawals also depend on anchor settlement.', 'Çekimler, havuzdaki kullanılabilir likiditeye bağlıdır. Onaydan önce tutar ve ücreti kontrol edin. TRY çekimleri ayrıca anchor mutabakatına bağlıdır.'],
  ['Is this a live financial service?', 'Bu gerçek para kullanılan bir hizmet mi?', 'This application runs on Stellar testnet with a mock TRY anchor. Use test assets only; do not send real money.', 'Bu uygulama Stellar testnet üzerinde, simüle edilmiş TRY anchor ile çalışır. Yalnızca test varlıkları kullanın; gerçek para göndermeyin.'],
];

export function InfoPage({ view }: { view: Exclude<View, 'home' | 'vault'> }) {
  const c = useCopy();
  const t = useT();
  const [search, setSearch] = useState('');
  if (view === 'learn') return <><section className="page-intro shell"><span className="eyebrow">STELPOOLS / {c('LEARN', 'KEŞFET')}</span><h1>{c('A little knowledge.', 'Biraz bilgi.')}<br/><mark>{c('More confidence.', 'Daha fazla güven.')}</mark></h1><p>{c('Everything you need to take your first step with Stelpools.', 'Stelpools ile ilk adımınızı atmak için bilmeniz gerekenler.')}</p><Steps/></section><section className="faq-section shell"><h2>{c('Frequently asked questions', 'Sıkça sorulan sorular')}</h2><label className="search-label" htmlFor="faq-search">{c('Search questions', 'Sorularda ara')}</label><input id="faq-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={c('Wallet, transfers, fees…', 'Cüzdan, transferler, ücretler…')} className="faq-search"/>{questions.filter(q => c(q[0], q[1]).toLocaleLowerCase().includes(search.toLocaleLowerCase()) || c(q[2], q[3]).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(q => <details key={q[0]}><summary>{c(q[0], q[1])}<span aria-hidden>+</span></summary><p>{c(q[2], q[3])}</p></details>)}{search && !questions.some(q => c(q[0], q[1]).toLocaleLowerCase().includes(search.toLocaleLowerCase()) || c(q[2], q[3]).toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p role="status">{c('No matching questions. Try “wallet” or clear your search.', 'Eşleşen soru yok. “Cüzdan” arayın veya aramayı temizleyin.')}</p>}</section></>;
  if (view === 'fees') return <section className="page-intro shell"><span className="eyebrow">STELPOOLS / {c('FEES', 'ÜCRETLER')}</span><h1>{c('Clear fees.', 'Şeffaf ücretler.')}<br/><mark>{c('In plain sight.', 'Her adımda açık.')}</mark></h1><p>{c('Understand what you pay before you make your move.', 'İşlem yapmadan önce hangi ücretleri ödediğinizi bilin.')}</p><div className="fee-table" role="table" aria-label={c('Fee overview', 'Ücret özeti')}><div role="row" className="fee-table-head"><span role="columnheader">{c('Operation', 'İşlem')}</span><span role="columnheader">{c('How the fee is determined', 'Ücret nasıl belirlenir?')}</span></div>{[
    [c('Pool withdrawals', 'Havuzdan çekim'), c('Set by the vault contract. The current rate is shown in the pool before confirmation.', 'Kasa kontratında belirlenir. Güncel oran, onaydan önce havuz ekranında gösterilir.')],
    [c('TRY ↔ USDC transfers', 'TRY ↔ USDC transferleri'), c('The anchor supplies the quote and any applicable fees for your transfer.', 'Anchor, transferinize özel kuru ve geçerli ücretleri sağlar.')],
    [c('Price impact', 'Fiyat etkisi'), c('Large trades move the pool’s price against you. The swap screen shows the impact and your minimum before you sign.', 'Büyük işlemler havuzun fiyatını aleyhinize kaydırır. Takas ekranı imzalamadan önce etkiyi ve alt sınırınızı gösterir.')],
    [c('Network fees', 'Ağ ücretleri'), c('Stellar network fees are paid in XLM and shown in your wallet.', 'Stellar ağ ücretleri XLM ile ödenir ve cüzdanınızda gösterilir.')],
  ].map(([title, description]) => <div role="row" key={title}><strong role="cell">{title}</strong><p role="cell">{description}</p></div>)}</div><Action>{c('View current pool fees', 'Güncel havuz ücretlerini gör')}</Action></section>;
  return <><section className="page-intro shell"><span className="eyebrow">STELPOOLS / {c('ABOUT', 'HAKKIMIZDA')}</span><h1><mark>{c('Open finance.', 'Açık finans.')}</mark><br/>{c('Closer to home.', 'Artık daha yakın.')}</h1><p>{c('Building the connection between everyday money and an on-chain world.', 'Günlük hayattaki paranız ile zincir üstü dünya arasında bir bağlantı kuruyoruz.')}</p><div className="about-grid"><LineArt kind="bridge"/><div><h2>{c('Local roots. Open rails.', 'Yerel bir başlangıç. Açık bir altyapı.')}</h2><p>{t('about.p1')}</p><p>{t('about.p2')}</p><a className="text-link" href={explorerContract()} target="_blank" rel="noreferrer">{c('Explore our contract', 'Kontratımızı inceleyin')} <Arrow/></a></div></div></section><section className="risk-section"><div className="shell"><span className="eyebrow">{c('TRANSPARENCY FIRST', 'ÖNCE ŞEFFAFLIK')}</span><h2>{c('Know how it works.', 'Nasıl çalıştığını bilin.')}<br/>{c('Understand the risks.', 'Riskleri anlayın.')}</h2><div className="feature-grid">{[
    [c('Your wallet, your keys', 'Sizin cüzdanınız, sizin anahtarlarınız'), c('You sign transactions in your own wallet. Assets deposited in the vault are managed by its smart contract.', 'İşlemleri kendi cüzdanınızda imzalarsınız. Kasaya yatırılan varlıklar akıllı kontrat tarafından yönetilir.')],
    [c('An anchor for bank transfers', 'Banka transferleri için anchor'), c('Fiat settlement relies on the anchor. Bank transfers are not validated by the blockchain itself.', 'Fiat mutabakatı anchor’a bağlıdır. Banka transferleri blokzincir tarafından doğrudan doğrulanmaz.')],
    [c('An early-stage protocol', 'Erken aşama bir protokol'), c('Contract bugs, limited liquidity and administrative controls carry risks. This is a testnet demonstration.', 'Kontrat hataları, sınırlı likidite ve yönetici yetkileri risk taşır. Bu bir testnet gösterimidir.')],
  ].map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}</div></div></section></>;
}

export function Footer() {
  const c = useCopy();
  return <footer className="site-footer"><div className="shell"><div className="footer-top"><a className="wordmark" href="#/home"><img src="/logo-dark-bg.png" width="180" height="44" alt="Stelpools"/></a><div><h3>{c('Products', 'Ürünler')}</h3><a href="#/vault">{c('Buy & sell', 'Alım & satım')}</a><a href="#/vault/deposit">{c('Liquidity pool', 'Likidite havuzu')}</a><a href="#/vault/withdraw">{c('Withdraw', 'Çekim')}</a></div><div><h3>{c('Discover', 'Keşfedin')}</h3><a href="#/about">{c('About Stelpools', 'Stelpools hakkında')}</a><a href="#/learn">{c('How it works', 'Nasıl çalışır?')}</a><a href="#/fees">{c('Fees', 'Ücretler')}</a></div><div><h3>{c('Resources', 'Kaynaklar')}</h3><a href={explorerContract()} target="_blank" rel="noreferrer">{c('View contract', 'Kontratı görüntüle')} ↗</a><a href="https://stellar.org" target="_blank" rel="noreferrer">Stellar ↗</a><a href="#/learn">{c('Help & FAQ', 'Yardım & SSS')}</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Stelpools</span><span className="testnet-chip"><span className="status-dot"/>Stellar Testnet</span><span>TRY ↔ USDC</span></div><p className="footer-disclaimer">{c('Stelpools is a testnet application with a simulated TRY anchor. Use test assets only. Do not send real money. Pool returns are variable and are not guaranteed.', 'Stelpools, simüle edilmiş TRY anchor kullanan bir testnet uygulamasıdır. Yalnızca test varlıkları kullanın. Gerçek para göndermeyin. Havuz getirisi değişkendir ve garanti edilmez.')}</p></div></footer>;
}
