import { sql, lit } from "./postgres.mjs";

const allowed = new Set(["billing_payment_attempts", "billing_orders", "billing_provider_events", "billing_plan_versions", "billing_plans", "billing_entitlement_applications", "billing_settlement_outcomes"]);
const ident = (value) => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error("Invalid test SQL identifier"); return `"${value}"`; };
const valueSql = (value) => value === null ? "NULL" : typeof value === "object" ? `${lit(JSON.stringify(value))}::jsonb` : typeof value === "boolean" || typeof value === "number" ? String(value) : lit(value);
async function queryRows(query) {
  const result = await sql(`SET ROLE service_role; SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${query}) q;`, "acceptance_app_service");
  return JSON.parse(result.split("\n").find((line) => line.startsWith("[")));
}
export function appDatabaseAdapter() {
  return {
    from(table) {
      if (!allowed.has(table)) throw Error("Table outside Billing acceptance scope");
      let columns = "*", insert, limit, order, offset = 0;
      const predicates = [];
      const run = async (single) => {
        try {
          let query;
          if (insert) {
            const keys = Object.keys(insert);
            const command = `WITH inserted AS (INSERT INTO public.${ident(table)} (${keys.map(ident).join(",")}) VALUES (${keys.map((key) => valueSql(insert[key])).join(",")}) RETURNING ${columns}) SELECT coalesce(jsonb_agg(inserted),'[]'::jsonb) FROM inserted`;
            const output = await sql(`SET ROLE service_role; ${command};`, "acceptance_app_service");
            const data = JSON.parse(output.split("\n").find((line) => line.startsWith("[")));
            return { data: single ? data[0] ?? null : data, error: null };
          } else query = `SELECT ${columns} FROM public.${ident(table)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}${order ? ` ORDER BY ${order}` : ""}${limit ? ` LIMIT ${limit}` : ""}${offset ? ` OFFSET ${offset}` : ""}`;
          const data = await queryRows(query);
          if (single && data.length > 1) return { data: null, error: { code: "PGRST116" } };
          return { data: single ? data[0] ?? null : data, error: null };
        } catch (error) {
          if(process.env.BILLING_ACCEPTANCE_VERBOSE==="1")console.error(String(error.message).split("\n").find((line)=>line.startsWith("ERROR:")));
          return { data: null, error: { code: /duplicate key/.test(error.message) ? "23505" : "P0001" } };
        }
      };
      const chain = {
        select(value) {
          columns = value === "*" ? "*" : table === "billing_provider_events" && value === "*,financial_integration_ref:raw_summary->>integration_id"
            ? "*,raw_summary->>'integration_id' AS financial_integration_ref"
            : value.split(",").map((part) => ident(part.trim())).join(",");
          return chain;
        },
        returns() { return chain; },
        eq(key, value) { predicates.push(`${ident(key)}=${valueSql(value)}`); return chain; },
        in(key, values) { predicates.push(`${ident(key)} IN (${values.map(valueSql).join(",")})`); return chain; },
        gte(key, value) { predicates.push(`${ident(key)}>=${valueSql(value)}`); return chain; },
        lt(key, value) { predicates.push(`${ident(key)}<${valueSql(value)}`); return chain; },
        order(key, options) { order = `${ident(key)} ${options?.ascending === false ? "DESC" : "ASC"}`; return chain; },
        limit(value) { if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid limit"); limit = value; return chain; },
        range(start, end) { if (![start,end].every(Number.isSafeInteger) || start < 0 || end < start) throw Error("Invalid range"); offset = start; limit = end - start + 1; return chain; },
        insert(value) { insert = value; return chain; },
        maybeSingle: () => run(true), single: () => run(true), then: (resolve, reject) => run(false).then(resolve, reject),
      };
      return chain;
    },
    async rpc(name, args) {
      if (!["billing_settle_paymob_hmac_verified", "billing_read_company_operational_entitlement"].includes(name)) throw Error("RPC outside acceptance scope");
      try {
        const parameter = name === "billing_settle_paymob_hmac_verified" ? `${lit(JSON.stringify(args.p_evidence))}::jsonb` : `${lit(args.p_company_id)}::uuid`;
        const result = await sql(`SET ROLE service_role; SELECT public.${ident(name)}(${parameter});`, "acceptance_app_service");
        return { data: JSON.parse(result.split("\n").find((line) => line.startsWith("{"))), error: null };
      } catch { return { data: null, error: { code: "P0001" } }; }
    },
  };
}
