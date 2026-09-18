export type EntitlementKey = "single_video_analysis" | "profile_analysis";

export interface BillingProvider {
  createCheckout(input: {
    readonly userId: string;
    readonly planId: string;
  }): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export interface EntitlementService {
  hasEntitlement(userId: string, entitlement: EntitlementKey): Promise<boolean>;
}

export interface UsageService {
  canRunAnalysis(userId: string): Promise<boolean>;
  recordAnalysis(userId: string, analysisId: string): Promise<void>;
}
