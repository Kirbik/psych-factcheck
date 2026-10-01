export type HistoryCheckStatus = "completed" | "processing" | "failed";

export type HistoryCheck = {
  readonly id: string;
  readonly title: string;
  readonly status: HistoryCheckStatus;
  readonly claims: string;
  readonly date: string;
  readonly action: string;
  readonly href: string;
};

export type HistoryLoadResult =
  | { readonly kind: "ready"; readonly checks: readonly HistoryCheck[] }
  | { readonly kind: "unavailable" };
