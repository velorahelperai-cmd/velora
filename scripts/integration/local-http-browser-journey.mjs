// TEST ONLY. Real browser controls and local Auth/REST; no provider execution.
// Import this module only after the isolated stack and unmodified Next app start.
import { createRequire } from "node:module";
import { localEnvironment } from "./local-http-safety.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TIMEOUT = 60_000;
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function fail(code) { throw Error(code); }
function requireLocalOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) fail("LOCAL_HTTP_ORIGIN_REQUIRED");
  return url.origin;
}
function assert(condition, code) { if (!condition) fail(code); }

async function poll(operation, code) {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await pause(500);
  }
  fail(code);
}

// Only rendered labels/button names are retained, never input values or page bodies.
async function inspectControls(page) {
  return page.locator("label,button").evaluateAll(elements => elements.map(element => ({
    tag: element.tagName.toLowerCase(),
    text: (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim(),
    disabled: element.tagName === "BUTTON" ? element.disabled : undefined,
  })).filter(item => item.text));
}

async function screenshot(journey, name) {
  const path = join(journey.artifactDirectory, `${name}.png`);
  await journey.page.screenshot({ path, fullPage: true });
  journey.artifacts.push(path);
}

async function stage(journey, name, operation) {
  journey.stage = name;
  try {
    await operation();
    journey.passedCases.push(name);
    console.log(`PASS|${name}`);
    await screenshot(journey, name);
  } catch (error) {
    await screenshot(journey, `${name}-failed`).catch(() => {});
    // Playwright exceptions can include fill arguments and DOM text. Do not relay them.
    const code = /^[A-Z][A-Z0-9_]*$/.test(error?.message ?? "") ? error.message : error?.name === "TimeoutError" ? "TIMEOUT" : "ACTION_FAILED";
    const safeError = Error(`LOCAL_BROWSER_STAGE_FAILED:${name}:${code}`);
    safeError.journey = journey;
    throw safeError;
  }
}

async function navigate(journey, path) {
  const response = await journey.page.goto(new URL(path, journey.appOrigin).href, { waitUntil: "networkidle", timeout: TIMEOUT });
  assert(response && response.status() < 500, "LOCAL_PAGE_UNAVAILABLE");
  assert(new URL(journey.page.url()).origin === journey.appOrigin, "LOCAL_NAVIGATION_REQUIRED");
  journey.controls = await inspectControls(journey.page);
}

async function label(page, expression) {
  const field = page.getByLabel(expression);
  await field.waitFor({ state: "visible", timeout: TIMEOUT });
  assert(await field.count() === 1, "AMBIGUOUS_RENDERED_FIELD");
  return field;
}

/** Pinned React 19 test synchronization, not a product hook or click retry.
 * Next's first HTML can be visible before client handlers are attached. The
 * installed React DOM assigns __reactProps$ during hydration/commit. Wait for
 * the real onClick before the one deliberate interaction, instead of sleeping.
 */
export async function clickHydratedControl(control) {
  await control.waitFor({ state: "visible", timeout: TIMEOUT });
  await poll(() => control.evaluate(element => Object.getOwnPropertyNames(element)
    .filter(key => key.startsWith("__reactProps$"))
    .some(key => typeof element[key]?.onClick === "function")), "CLIENT_CONTROL_NOT_HYDRATED");
  await control.click();
}

/**
 * afterKnowledge(journey) may publish catalog through a separate platform-owner
 * browser context or install explicitly synthetic backend provider evidence.
 * Initial Auth/company/knowledge writes below always use real user UI actions.
 * Returned credentials stay in memory; callers must never serialize this object.
 */
export async function runBrowserJourney(stack, { appOrigin = "http://127.0.0.1:3120", afterKnowledge, verifyCheckoutBlocked = false, recordSetupNavigationFailure = false } = {}) {
  appOrigin = requireLocalOrigin(appOrigin);
  const backendOrigin = requireLocalOrigin(stack?.url);
  assert(typeof stack.rows === "function" && typeof stack.verify === "function", "ISOLATED_STACK_REQUIRED");
  await stack.verify();
  const packagePath = join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json");
  const { chromium } = createRequire(packagePath)("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome", env: localEnvironment() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
  context.setDefaultTimeout(TIMEOUT);
  context.setDefaultNavigationTimeout(TIMEOUT);
  const blockedOrigins = new Set();
  await context.route("**/*", route => {
    let url;
    try { url = new URL(route.request().url()); } catch { return route.abort(); }
    const localApp = url.origin === appOrigin;
    const localBackend = url.origin === backendOrigin && /^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname);
    if (localApp || localBackend) return route.continue();
    blockedOrigins.add(url.origin);
    return route.abort();
  });
  // Locale uses the application's own public cookie, not injected Auth state.
  await context.addCookies([{ name: "velora_locale", value: "en", url: appOrigin, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("dialog", dialog => dialog.type() === "confirm" && /unsaved|تعديلات|تغييرات/.test(dialog.message())
    ? dialog.accept() : dialog.dismiss());
  const runId = randomUUID().slice(0, 8);
  const journey = {
    browser, context, page, appOrigin,
    user: { email: `c1-ui-${randomUUID()}@example.invalid`, password: `${randomBytes(24).toString("base64url")}aA7!` },
    companyId: null, knowledgeId: null,
    passedCases: [], failedCases: [], blockedCases: [], artifacts: [], blockedOrigins,
    artifactDirectory: join(ROOT, "artifacts/local-http-browser-journey", runId),
    close: async () => { await context.close(); await browser.close(); },
  };
  await mkdir(journey.artifactDirectory, { recursive: true });
  try {
    await stage(journey, "browser-signup-real-local-auth", async () => {
      await navigate(journey, "/signup");
      await (await label(page, /^Full name/)).fill("Local browser business owner");
      await (await label(page, /^Email address/)).fill(journey.user.email);
      await (await label(page, /^Password/)).fill(journey.user.password);
      await (await label(page, /^Confirm password/)).fill(journey.user.password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/setup", { timeout: TIMEOUT });
      await page.waitForLoadState("networkidle");
      const user = await poll(async () => {
        const rows = await stack.rows(`SELECT u.id,u.email_confirmed_at,
          (SELECT count(*)::integer FROM auth.identities i WHERE i.user_id=u.id) AS identities,
          (SELECT count(*)::integer FROM auth.sessions s WHERE s.user_id=u.id) AS sessions
          FROM auth.users u WHERE lower(u.email)=lower(${lit(journey.user.email)})`);
        return rows[0]?.email_confirmed_at && rows[0].identities > 0 && rows[0].sessions > 0 ? rows[0] : null;
      }, "REAL_AUTH_IDENTITY_SESSION_NOT_PERSISTED");
      journey.user.id = user.id;
      const memberships = await stack.rows(`SELECT company_id FROM public.company_members WHERE user_id=${lit(user.id)}::uuid`);
      assert(memberships.length === 0, "SIGNUP_MUST_NOT_CREATE_COMPANY");
      journey.controls = await inspectControls(page);
    });

    await stage(journey, "browser-company-profile-persisted", async () => {
      await (await label(page, /^Business name/)).fill(`Local UI Workshop ${runId}`);
      await (await label(page, /^Business type/)).selectOption("other");
      await (await label(page, /^Country/)).selectOption("OM");
      await (await label(page, /^City/)).fill("Muscat");
      await (await label(page, /^Working hours/)).fill("Sunday–Thursday 09:00–18:00");
      // Phone is optional. Do not use any potentially real phone number.
      await (await label(page, /^Contact email/)).fill("local-workshop@example.invalid");
      await page.getByRole("button", { name: "Save and continue", exact: true }).click();
      const company = await poll(async () => {
        const rows = await stack.rows(`SELECT c.id,c.status,c.display_name,c.hours,m.role,m.status AS member_status
          FROM public.companies c JOIN public.company_members m ON m.company_id=c.id
          WHERE m.user_id=${lit(journey.user.id)}::uuid AND m.role='owner'`);
        return rows.length === 1 && rows[0].display_name === `Local UI Workshop ${runId}` && rows[0].hours ? rows[0] : null;
      }, "COMPANY_UI_SAVE_NOT_PERSISTED");
      assert(company.status === "setup" && company.role === "owner" && company.member_status === "active", "COMPANY_OWNER_STATE_INVALID");
      journey.companyId = company.id;
      await page.getByRole("button", { name: /Subscription Plan/ }).waitFor({ state: "visible" });
    });

    await stage(journey, "browser-knowledge-text-write", async () => {
      await navigate(journey, "/app/knowledge");
      await clickHydratedControl(page.getByRole("button", { name: /Add information/ }));
      await (await label(page, /^Title/)).fill("Local integration workshop facts");
      await (await label(page, /^Details/)).fill("This synthetic workshop opens Sunday–Thursday 09:00–18:00. Synthetic coffee costs 2.000 OMR. Returns are accepted within seven days with a receipt. Delivery within Muscat costs 1.000 OMR.");
      await (await label(page, /Knowledge purpose/)).selectOption("knowledge");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const source = await poll(async () => {
        const rows = await stack.rows(`SELECT id,status,approved_for_answers,content_version,created_by FROM public.knowledge_sources
          WHERE company_id=${lit(journey.companyId)}::uuid AND title='Local integration workshop facts'`);
        return rows.length === 1 && rows[0].status === "ready" ? rows[0] : null;
      }, "KNOWLEDGE_UI_WRITE_NOT_PERSISTED");
      assert(source.created_by === journey.user.id && source.approved_for_answers === false, "KNOWLEDGE_WRITE_MUST_NOT_APPROVE");
      journey.knowledgeId = source.id;
    });

    await stage(journey, "browser-owner-knowledge-approval", async () => {
      journey.controls = await inspectControls(page);
      const row = page.locator("li").filter({ hasText: "Local integration workshop facts" });
      assert(await row.count() === 1, "KNOWLEDGE_ROW_AMBIGUOUS");
      await row.getByRole("button", { name: "✓ اعتماد للإجابات", exact: true }).click();
      await poll(async () => {
        const [source] = await stack.rows(`SELECT approved_for_answers,approved_version,content_version,approved_by,approved_at FROM public.knowledge_sources WHERE id=${lit(journey.knowledgeId)}::uuid`);
        return source?.approved_for_answers && source.approved_version === source.content_version && source.approved_by === journey.user.id && source.approved_at;
      }, "OWNER_KNOWLEDGE_APPROVAL_NOT_PERSISTED");
      await row.getByText("✓ معتمد لإجابات نورا", { exact: true }).waitFor({ state: "visible" });
    });

    if (afterKnowledge) await stage(journey, "after-knowledge-local-fixture-callback", () => afterKnowledge(journey));

    await stage(journey, "browser-published-plan-display", async () => {
      await navigate(journey, "/app/settings?tab=plan");
      const published = await stack.rows("SELECT v.id,v.amount_baisa FROM public.billing_plan_versions v JOIN public.billing_plans p ON p.id=v.plan_id WHERE p.code='noor_basic' AND v.status='published' AND v.period_unit='month' AND v.period_count=1 ORDER BY v.version DESC LIMIT 1");
      if (!published.length) {
        journey.blockedCases.push({ case: "published-plan-selection", reason: "NO_PUBLISHED_NOURA_BASIC_VERSION" });
        assert(await page.getByRole("button", { name: /Select plan Noura \/ Basic/ }).count() === 0, "DRAFT_PLAN_MUST_NOT_BE_SELECTABLE");
        return;
      }
      const price = page.locator(`[data-catalog-version="${published[0].id}"]`).first();
      await price.waitFor({ state: "visible" });
      assert((await price.textContent()).replaceAll(",", "").includes((Number(published[0].amount_baisa) / 1000).toFixed(3)), "PUBLISHED_PRICE_NOT_RENDERED");
      await page.getByRole("button", { name: "Select plan Noura / Basic", exact: true }).click();
      await page.getByRole("button", { name: "Your selection Noura / Basic", exact: true }).waitFor({ state: "visible" });
      journey.planVersionId = published[0].id;
      if (verifyCheckoutBlocked) {
        // The orchestrator must explicitly keep all billing execution flags false
        // and provider keys blank in the Next process before opting into this check.
        const checkout = page.getByRole("button", { name: "Continue to test checkout", exact: true });
        if (await checkout.isEnabled()) {
          const ordersBefore = (await stack.rows(`SELECT count(*)::integer AS count FROM public.billing_orders WHERE company_id=${lit(journey.companyId)}::uuid`))[0].count;
          await checkout.click();
          await page.getByRole("alert").filter({ hasText: "Paymob Test setup is incomplete." }).waitFor({ state: "visible" });
          const ordersAfter = (await stack.rows(`SELECT count(*)::integer AS count FROM public.billing_orders WHERE company_id=${lit(journey.companyId)}::uuid`))[0].count;
          assert(ordersAfter === ordersBefore, "DISABLED_CHECKOUT_MUST_NOT_CREATE_ORDER");
          journey.passedCases.push("browser-checkout-fails-closed-before-order-provider");
        } else journey.blockedCases.push({ case: "checkout-submit", reason: "CHECKOUT_UI_DISABLED_FOR_SUBSCRIPTION_STATE" });
      }
      journey.blockedCases.push({ case: "provider-checkout", reason: "PROVIDER_EXECUTION_EXCLUDED_LOCAL_PAYMENT_EVIDENCE_ONLY" });
    });

    await stage(journey, "browser-meta-honest-needs-setup", async () => {
      await navigate(journey, "/app/settings?tab=whatsapp");
      await page.getByText("Connect with Meta", { exact: true }).waitFor({ state: "visible" });
      await page.getByText(/Meta connection is awaiting setup\./).waitFor({ state: "visible" });
      assert(await page.getByRole("button", { name: "Prepare secure connection", exact: true }).count() === 0, "META_SDK_MUST_REMAIN_UNCONFIGURED");
      await page.getByText(/Live replies are disabled;/).waitFor({ state: "visible" });
      journey.blockedCases.push({ case: "real-meta-authorization", reason: "NEEDS_SETUP_EXTERNAL_META_EXCLUDED" });
    });

    await stage(journey, "browser-customer-tester-honest-needs-setup", async () => {
      await navigate(journey, "/app/test");
      await (await label(page, "Type a question the way your customer would…")).fill("What are your working hours?");
      await page.getByRole("button", { name: "Test", exact: true }).click();
      await page.getByText("NEEDS_SETUP — no answer provider is adopted yet. No fake reply.", { exact: true }).waitFor({ state: "visible" });
      journey.blockedCases.push({ case: "customer-noura-trial", reason: "SOURCE_PROVIDER_NULL_LIVE_ANSWERING_FALSE" });
    });

    try { await stage(journey, "browser-setup-review-remains-disabled", async () => {
      await navigate(journey, "/setup");
      await clickHydratedControl(page.getByRole("button", { name: /Go-Live Readiness & Approval/ }));
      const submit = page.getByRole("button", { name: "Ask us to help with activation", exact: true });
      await submit.waitFor({ state: "visible" });
      assert(await submit.isDisabled(), "REVIEW_MUST_REQUIRE_SUCCESSFUL_CUSTOMER_TRIAL");
      const reviews = await stack.rows(`SELECT company_id FROM public.company_review_requests WHERE company_id=${lit(journey.companyId)}::uuid`);
      assert(reviews.length === 0, "BLOCKED_REVIEW_MUST_NOT_CREATE_REQUEST");
      journey.blockedCases.push({ case: "new-company-review-submit", reason: "SUCCESSFUL_CUSTOMER_TRIAL_UNAVAILABLE" });
    }); } catch (error) {
      const buttons = page.locator("ol[aria-label] button");
      const observedStep = await buttons.evaluateAll(items => items.findIndex(item => item.getAttribute("aria-current") === "step"));
      // Explicit diagnostic mode only: retain the actual failure and continue
      // independent synthetic worker checks. Never retry the click or fabricate
      // successful review navigation, and never suppress an unrelated error.
      if (!recordSetupNavigationFailure || error.message !== "LOCAL_BROWSER_STAGE_FAILED:browser-setup-review-remains-disabled:TIMEOUT" || observedStep < 0 || observedStep === 7) throw error;
      journey.failedCases.push({ case: "browser-setup-review-remains-disabled", reason: "REVIEW_STEP_NOT_REACHED_AFTER_CLICK", expectedStep: 7, observedStep, evidence: journey.artifacts.at(-1) });
      journey.blockedCases.push({ case: "new-company-review-submit", reason: "SETUP_NAVIGATION_UNVERIFIED" });
      console.log("FAIL|browser-setup-review-remains-disabled|REVIEW_STEP_NOT_REACHED_AFTER_CLICK");
    }
    return journey;
  } catch (error) {
    await journey.close().catch(() => {});
    throw error;
  }
}

/**
 * Continue after root installs a signed synthetic incoming message. afterResume
 * can run its explicitly mocked model/send fixture before the actual UI takeover.
 */
export async function finishInboxJourney(stack, journey, { conversationId, expectedReplyText, afterResume, takeOver = true } = {}) {
  assert(uuid(conversationId) && uuid(journey.companyId) && uuid(journey.user.id), "SYNTHETIC_INBOX_BINDING_REQUIRED");
  const page = journey.page;
  const conversation = async () => (await stack.rows(`SELECT id,customer_name,automation_allowed,status,control_revision,automation_generation FROM public.whatsapp_conversations WHERE id=${lit(conversationId)}::uuid AND company_id=${lit(journey.companyId)}::uuid`))[0];
  const accounting = async () => stack.rows(`SELECT status,count(*)::integer AS attempts,coalesce(sum(total_tokens),0)::text AS tokens,coalesce(sum(cost_baisa),0)::text AS cost FROM public.ai_usage_ledger WHERE company_id=${lit(journey.companyId)}::uuid GROUP BY status ORDER BY status`);

  await stage(journey, "browser-inbox-incoming-thread-read", async () => {
    const row = await conversation();
    assert(row?.customer_name, "INBOX_FIXTURE_CONVERSATION_NOT_FOUND");
    await navigate(journey, "/app/conversations");
    const list = page.locator('section[aria-label="Conversations List"]');
    const card = list.getByRole("button").filter({ hasText: row.customer_name });
    await card.waitFor({ state: "visible" });
    assert(await card.count() === 1, "INBOX_CUSTOMER_SELECTION_AMBIGUOUS");
    await card.click();
    await page.waitForURL(url => url.searchParams.get("c") === conversationId);
    console.log("LOCAL_UI_STEP|thread-selected");
    const latestInbound = (await stack.rows(`SELECT id,arrival_sequence::text AS sequence FROM public.whatsapp_messages WHERE conversation_id=${lit(conversationId)}::uuid AND direction='inbound' ORDER BY arrival_sequence DESC LIMIT 1`))[0];
    assert(latestInbound, "INBOUND_FIXTURE_MESSAGE_REQUIRED");
    await poll(async () => {
      const [marker] = await stack.rows(`SELECT last_read_sequence::text AS sequence,displayed_inbound_message_id FROM private.whatsapp_inbox_read_markers WHERE company_id=${lit(journey.companyId)}::uuid AND conversation_id=${lit(conversationId)}::uuid AND user_id=${lit(journey.user.id)}::uuid`);
      return marker?.displayed_inbound_message_id === latestInbound.id && BigInt(marker.sequence) >= BigInt(latestInbound.sequence);
    }, "VISIBLE_THREAD_READ_NOT_PERSISTED");
    console.log("LOCAL_UI_STEP|read-marker-persisted");
    const current = await conversation();
    if (!current.automation_allowed) {
      // Visible button text includes a decorative robot; the existing title is
      // the stable action label. Do not require an emoji-free accessible name.
      const resume = page.getByTitle("Resume Noura", { exact: true });
      await clickHydratedControl(resume);
      await poll(async () => (await conversation())?.automation_allowed === true, "UI_RESUME_NOT_PERSISTED");
      journey.passedCases.push("browser-inbox-resume-automation");
    }
  });

  if (afterResume) await stage(journey, "after-resume-local-model-fixture-callback", () => afterResume(journey));

  await stage(journey, "browser-inbox-saved-mock-noura-response", async () => {
    await page.getByTitle("Refresh inbox", { exact: true }).click();
    const reply = (await stack.rows(`SELECT body FROM public.whatsapp_messages WHERE conversation_id=${lit(conversationId)}::uuid AND sender='assistant' ORDER BY arrival_sequence DESC LIMIT 1`))[0];
    assert(reply?.body && (!expectedReplyText || reply.body === expectedReplyText), "MOCK_NOURA_RESPONSE_NOT_PERSISTED");
    await page.getByText(reply.body, { exact: true }).last().waitFor({ state: "visible" });
  });

  if (takeOver) await stage(journey, "browser-human-takeover-and-accounting-retained", async () => {
    const before = await conversation();
    const usageBefore = JSON.stringify(await accounting());
    const auditBefore = (await stack.rows(`SELECT count(*)::integer AS count FROM public.whatsapp_conversation_events WHERE company_id=${lit(journey.companyId)}::uuid AND conversation_id=${lit(conversationId)}::uuid AND action='take_over' AND actor_user_id=${lit(journey.user.id)}::uuid`))[0].count;
    await clickHydratedControl(page.getByTitle("Take over from Noura", { exact: true }));
    await poll(async () => {
      const current = await conversation();
      return current?.automation_allowed === false && current.status === "handed_over" && current.control_revision > before.control_revision && current.automation_generation > before.automation_generation;
    }, "UI_HUMAN_TAKEOVER_NOT_PERSISTED");
    await page.getByText("Taken over. Noura auto-reply paused.", { exact: true }).waitFor({ state: "visible" });
    const auditAfter = (await stack.rows(`SELECT count(*)::integer AS count FROM public.whatsapp_conversation_events WHERE company_id=${lit(journey.companyId)}::uuid AND conversation_id=${lit(conversationId)}::uuid AND action='take_over' AND actor_user_id=${lit(journey.user.id)}::uuid`))[0].count;
    assert(auditAfter === auditBefore + 1, "UI_TAKEOVER_AUDIT_MISSING");
    assert(JSON.stringify(await accounting()) === usageBefore, "TAKEOVER_MUST_RETAIN_ACCOUNTING");
  });
  return journey;
}
