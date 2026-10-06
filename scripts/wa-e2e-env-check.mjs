/**
 * Presence-only check for VEL-WA-TEST-NUMBER-END-TO-END-01.
 * Never prints secret values. Exit 0 always when runnable.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v.trim();
  }
  return out;
}

function present(v) {
  return Boolean(v && String(v).trim());
}

function fingerprint(v) {
  if (!present(v)) return null;
  return createHash("sha256").update(String(v).trim()).digest("hex").slice(0, 12);
}

const env = {
  ...loadEnvFile(resolve(process.cwd(), ".env")),
  ...loadEnvFile(resolve(process.cwd(), ".env.local")),
  ...process.env,
};

const companyId = (env.WHATSAPP_COMPANY_ID || env.WHATSAPP_TEST_COMPANY_ID || "").trim();
const phoneId = (env.WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_TEST_PHONE_NUMBER_ID || "").trim();
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const report = {
  keys: {
    WHATSAPP_APP_SECRET: present(env.WHATSAPP_APP_SECRET),
    WHATSAPP_VERIFY_TOKEN: present(env.WHATSAPP_VERIFY_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: present(env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_TEST_PHONE_NUMBER_ID: present(env.WHATSAPP_TEST_PHONE_NUMBER_ID),
    WHATSAPP_COMPANY_ID: present(env.WHATSAPP_COMPANY_ID),
    WHATSAPP_TEST_COMPANY_ID: present(env.WHATSAPP_TEST_COMPANY_ID),
    WHATSAPP_ACCESS_TOKEN: present(env.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_ROUTING_MODE: env.WHATSAPP_ROUTING_MODE?.trim() || "(default single_tenant)",
    WHATSAPP_ALLOW_EXTERNAL_SEND: env.WHATSAPP_ALLOW_EXTERNAL_SEND?.trim() || "(unset)",
    SUPABASE_SERVICE_ROLE_KEY: present(serviceKey),
    NEXT_PUBLIC_SUPABASE_URL: present(url),
  },
  resolved: {
    companyIdFp: fingerprint(companyId),
    phoneIdFp: fingerprint(phoneId),
    companyIdUuidShape: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId),
    phoneIdLooksNumeric: /^\d{5,30}$/.test(phoneId),
  },
  db: null,
};

if (!url || !serviceKey || !companyId) {
  report.db = { ok: false, reason: "missing_url_or_service_or_company" };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const company = await rest(
  `companies?id=eq.${encodeURIComponent(companyId)}&select=id,status,display_name`,
);
const members = await rest(
  `company_members?company_id=eq.${encodeURIComponent(companyId)}&select=user_id,role,status`,
);
const convCount = await rest(
  `whatsapp_conversations?company_id=eq.${encodeURIComponent(companyId)}&select=id`,
);
const msgCount = await rest(
  `whatsapp_messages?company_id=eq.${encodeURIComponent(companyId)}&select=id`,
);

const companyRow = Array.isArray(company.json) ? company.json[0] : null;
const memberRows = Array.isArray(members.json) ? members.json : [];

report.db = {
  ok: company.status === 200 && Boolean(companyRow),
  companyStatus: companyRow?.status ?? null,
  companyNameLen: companyRow?.display_name ? String(companyRow.display_name).length : 0,
  membersTotal: memberRows.length,
  membersActive: memberRows.filter((m) => m.status === "active").length,
  ownersActive: memberRows.filter((m) => m.status === "active" && m.role === "owner").length,
  conversationsForCompany: Array.isArray(convCount.json) ? convCount.json.length : -1,
  messagesForCompany: Array.isArray(msgCount.json) ? msgCount.json.length : -1,
  http: {
    company: company.status,
    members: members.status,
  },
};

console.log(JSON.stringify(report, null, 2));
