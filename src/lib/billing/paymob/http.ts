/**
 * Mockable HTTP port for Paymob Oman API calls.
 * Tests inject fakes — this package never opens real network sockets to Paymob.
 */

export type PaymobHttpMethod = "GET" | "POST";

export type PaymobHttpRequest = {
  method: PaymobHttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** Milliseconds; exceeded → timeout / unknown. */
  timeoutMs: number;
};

export type PaymobHttpResponse = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
};

export type PaymobHttpResult =
  | { kind: "response"; response: PaymobHttpResponse }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string };

export type PaymobHttpClient = {
  request(input: PaymobHttpRequest): Promise<PaymobHttpResult>;
};

/** Test-only mock: scripted replies by URL substring / call count. */
export function createMockPaymobHttpClient(
  handlers: Array<{
    match: (req: PaymobHttpRequest) => boolean;
    result: PaymobHttpResult | ((req: PaymobHttpRequest) => PaymobHttpResult);
  }>,
): PaymobHttpClient & { calls: PaymobHttpRequest[] } {
  const calls: PaymobHttpRequest[] = [];
  return {
    calls,
    async request(input) {
      calls.push(input);
      const hit = handlers.find((h) => h.match(input));
      if (!hit) {
        return { kind: "network_error", message: `no mock handler for ${input.method} ${input.url}` };
      }
      return typeof hit.result === "function" ? hit.result(input) : hit.result;
    },
  };
}
