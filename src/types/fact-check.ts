export const verdicts = [
  "SUPPORTED",
  "MOSTLY_SUPPORTED",
  "OVERSIMPLIFIED",
  "INSUFFICIENT_EVIDENCE",
  "CONTRADICTED",
  "UNVERIFIABLE",
] as const;

export type Verdict = (typeof verdicts)[number];
