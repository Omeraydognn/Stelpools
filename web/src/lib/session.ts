export interface Session {
  address: string;
  /**
   * `idle` until the wallet does something that needs the anchor.
   *
   * A SEP-10 token costs a wallet signature, so it is never taken up front.
   * The deposit and withdrawal flows obtain one themselves and register the
   * SEP-12 customer as part of the same step.
   */
  kyc: "idle" | "pending" | "accepted" | "failed";
  kycError?: string;
  jwt?: string;
}
