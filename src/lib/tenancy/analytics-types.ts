export interface PlanTierMetric {
  planId: string;
  planNameAr: string;
  planNameEn: string;
  activeTenantsCount: number;
  monthlyPriceBaisa: number | null;
  monthlyRevenueBaisa: number | null;
  sharePercent: number;
}

export interface MonthlyRevenuePoint {
  monthKey: string;
  monthLabelAr: string;
  monthLabelEn: string;
  confirmedGrossBaisa: number;
  ordersCount: number;
}

export interface FinancialAnalyticsData {
  kpis: {
    testCollectedBaisa?: number;
    grossRealizedBaisa: number;
    grossRealizedOmr: string;
    activeSubscribedTenants: number;
    arpuOmr: string;
    paymentSuccessRatePercent: number | null;
    gatewayMode: "TEST_MODE_GUARDED" | "LIVE_READY";
  };
  planDistribution: PlanTierMetric[];
  monthlyHistory: MonthlyRevenuePoint[];
  aiMarginAnalysis: {
    realizedSubscriptionOmr: string;
    realizedAiConsumptionOmr: string;
    marginRatioPercent: number | null;
    status: "HEALTHY" | "ATTENTION" | "UNKNOWN";
  };
}
