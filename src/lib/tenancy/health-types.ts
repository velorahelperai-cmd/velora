export type HealthProbeStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "DOWN"
  | "GUARDED"
  | "UNCONFIGURED"
  | "UNKNOWN";

export interface SubsystemProbe {
  id: string;
  nameAr: string;
  nameEn: string;
  category: "database" | "auth" | "integrations" | "ai" | "storage";
  status: HealthProbeStatus;
  latencyMs: number | null;
  detailsAr: string;
  detailsEn: string;
  lastCheckedAt: string;
}

export interface SecurityInvariantCheck {
  id: string;
  labelAr: string;
  labelEn: string;
  status: "PASS" | "FAIL" | "WARN";
  evidence: string;
}

export interface PlatformHealthOverviewData {
  kpis: {
    overallStatus: "HEALTHY" | "DEGRADED" | "DOWN";
    dbLatencyMs: number;
    authStatus: "HEALTHY" | "DEGRADED";
    paymentGatewayMode: "TEST_MODE_GUARDED";
    aiRouterStatus: "READY_GUARDED" | "UNKNOWN";
  };
  probes: SubsystemProbe[];
  invariants: SecurityInvariantCheck[];
  evaluatedAt: string;
}
