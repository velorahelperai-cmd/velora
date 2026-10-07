export type CatalogTier = "level_1" | "level_2" | "level_3";
export type CatalogCycle = "monthly" | "yearly";
export type CatalogVersion = {
  versionId: string; planId: string; planCode: string; tier: CatalogTier;
  version: number; cycle: CatalogCycle; currency: "OMR"; amountBaisa: number;
  aiTextResponsesPerMonth: number | null;
  quotaEnforcement: "not_verified";
};
export type SubscriptionCatalog =
  | { status: "ready"; versions: CatalogVersion[] }
  | { status: "empty"; versions: [] }
  | { status: "unconfigured"; versions: []; reason: "schema_unavailable" | "server_reader_unavailable" | "read_permission_missing" | "tier_mapping_missing" | "invalid_catalog" }
  | { status: "error"; versions: []; reason: "load_failed" }
  | { status: "forbidden"; versions: []; reason: "owner_required" };
