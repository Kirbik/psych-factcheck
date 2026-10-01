export type ReportClaimStatus =
  "contradicted" | "disputed" | "not-found" | "supported";

export type ReportSource = {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly journal: string;
  readonly publisher: string;
  readonly publishedAt: string;
  readonly sourceType: string;
  readonly url: string | null;
};

export type ReportClaim = {
  readonly id: string;
  readonly title: string;
  readonly originalText: string;
  readonly normalizedText: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly verdict: string;
  readonly status: ReportClaimStatus;
  readonly confidence: number;
  readonly explanation: string;
  readonly sources: readonly ReportSource[];
};

export type ReportData = {
  readonly contentItemId: string;
  readonly fileName: string;
  readonly checkedAt: string;
  readonly claims: readonly ReportClaim[];
};

export type ReportLoadResult =
  | { readonly kind: "not_found" }
  | {
      readonly kind: "processing";
      readonly contentItemId: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "failed";
      readonly contentItemId: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "out_of_scope";
      readonly contentItemId: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "unavailable";
      readonly contentItemId: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "localization_unavailable";
      readonly contentItemId: string;
      readonly fileName: string;
    }
  | { readonly kind: "ready"; readonly report: ReportData };
