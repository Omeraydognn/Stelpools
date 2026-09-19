import { useState } from "react";

import { isTestnet } from "../lib/config";
import { formatIban } from "../lib/format";
import type { DepositInstructions } from "../lib/sep6";
import { Button } from "./ui";

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm ${mono ? "tnum" : ""}`}>{value}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          aria-label={`${label} kopyala`}
          className="min-h-10 rounded-[var(--radius)] px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {copied ? "kopyalandı" : "kopyala"}
        </button>
      </div>
    </div>
  );
}

/**
 * The part of an on-ramp that actually involves a bank.
 *
 * The anchor hands back its own IBAN and a reference code; the user sends
 * the lira themselves and the anchor matches it by that code. Skipping
 * straight to the sandbox's simulate endpoint hides the only step that will
 * exist in production, so it is shown here and simulated explicitly.
 */
export function DepositInstructionsCard({
  instructions,
  onSimulate,
  simulating,
  simulated,
}: {
  instructions: DepositInstructions;
  onSimulate: () => void;
  simulating: boolean;
  simulated: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-3">
      <div>
        <p className="text-sm font-medium">Bankanızdan bu hesaba gönderin</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Açıklamaya kodu birebir yazın — anchor parayı bu kodla sizin işleminize bağlar.
          Kod olmadan transfer eşleşmez.
        </p>
      </div>

      <div>
        <CopyRow label="Banka" value={instructions.bankName} mono={false} />
        <CopyRow label="IBAN" value={formatIban(instructions.iban)} />
        <CopyRow label="Tutar" value={`${instructions.amountTry} TRY`} />
        <CopyRow label="Açıklama" value={instructions.reference} />
      </div>

      {isTestnet && (
        <div className="grid gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Testnet: gerçek bir havale yapılamayacağı için anchor'ın sandbox'ı transferi sizin
            yerinize kaydedebilir. Canlıda bu düğme olmaz; parayı bankanızdan siz gönderirsiniz.
          </p>
          <Button
            variant="ghost"
            className="justify-self-start"
            loading={simulating}
            disabled={simulated}
            onClick={onSimulate}
          >
            {simulated ? "Transfer kaydedildi" : "Havaleyi gönderdim (sandbox)"}
          </Button>
        </div>
      )}
    </div>
  );
}
