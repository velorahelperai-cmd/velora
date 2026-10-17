import "server-only";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";

type BrokerLogFields = {
  request_id?: string;
  trace_id?: string;
  user_id?: string;
  tenant_id?: string;
  module?: string;
  operation?: string;
  stage?: string;
  error_code?: string;
  boundary_fp?: string;
  operation_id?: string;
  support_ref?: string;
  contract_version?: number;
  [key: string]: unknown;
};

export function brokerLog(
  severity: "info" | "warn" | "error",
  event: string,
  fields: BrokerLogFields = {},
): void {
  const {
    request_id,
    trace_id,
    user_id,
    tenant_id,
    ...rest
  } = fields;
  withLogContext(
    {
      ...(request_id ? { request_id } : {}),
      ...(trace_id ? { trace_id } : {}),
      ...(user_id ? { user_id } : {}),
      ...(tenant_id ? { tenant_id } : {}),
    },
    () => {
      logEvent(severity, event, {
        kind: "security",
        module: rest.module ?? "auth.broker",
        ...rest,
      });
    },
  );
}
