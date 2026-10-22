export type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "BLOCKED" | "UNKNOWN";

export type EventSeverity = "info" | "warning" | "error" | "critical";

export interface PlatformServiceHealth {
  id: string;
  name: string;
  status: ServiceStatus;
  latencyMs?: number;
  details?: string;
}

export interface WebhookPipeHealth {
  channel: string;
  status: "active" | "degraded" | "disconnected" | "unknown";
  eventsCount: number;
  successRate: string;
  lastActiveAt?: string | null;
}

export interface CorrelationLogEvent {
  id: string;
  traceId: string;
  requestId: string;
  companyId?: string | null;
  service: string;
  severity: EventSeverity;
  errorCode: string;
  message: string;
  createdAt: string;
}

export interface AdminOperationsData {
  kpis: {
    totalEvents: number | "UNKNOWN";
    activeIncidents: number;
    webhookSuccessRate: string;
    avgServerLatency: string;
    servicesHealth: "healthy" | "degraded" | "blocked" | "unknown";
  };
  services: PlatformServiceHealth[];
  webhookPipes: WebhookPipeHealth[];
  recentEvents: CorrelationLogEvent[];
  queryFilter?: {
    correlationId?: string;
    service?: string;
    severity?: string;
  };
}
