/**
 * Local isolation check: company draft storage must be keyed by user.
 * clearCompanyDrafts requires userId; missing id clears nothing.
 */
import assert from "node:assert/strict";

const COMPANY_DRAFT_PREFIX = "velora_company_draft_v1:";
const PREVIEW_KEY = "velora_preview_v1";

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

function keyFor(userId) {
  return `${COMPANY_DRAFT_PREFIX}${userId}`;
}

function emptyDraft(userId) {
  return {
    version: 1,
    userId,
    companyId: null,
    business: { name: "", type: "restaurant", replyLanguage: "both", country: "OM", city: "", hours: "", contactPhone: "", contactEmail: "" },
    setupStep: 0,
    setupDone: [false, false, false, false],
    businessSaved: false,
  };
}

function writeDraft(storage, draft) {
  storage.setItem(keyFor(draft.userId), JSON.stringify(draft));
}

function readDraft(storage, userId) {
  const raw = storage.getItem(keyFor(userId));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1 || parsed.userId !== userId) return null;
  return parsed;
}

/** Mirrors src/lib/company-draft.ts — no wipe-all when userId missing. */
function clearCompanyDrafts(storage, userId) {
  if (!userId) return;
  storage.removeItem(keyFor(userId));
}

const storage = createMemoryStorage();
storage.setItem(PREVIEW_KEY, JSON.stringify({ version: 1, viewAs: "owner", planInterest: "starter" }));

const userA = "user-a";
const userB = "user-b";
const draftA = emptyDraft(userA);
draftA.business.name = "Activity A";
writeDraft(storage, draftA);
const draftB = emptyDraft(userB);
draftB.business.name = "Activity B";
writeDraft(storage, draftB);

assert.equal(readDraft(storage, userA)?.business.name, "Activity A");
assert.equal(readDraft(storage, userB)?.business.name, "Activity B");

// Missing identity clears nothing
clearCompanyDrafts(storage, undefined);
clearCompanyDrafts(storage, null);
clearCompanyDrafts(storage, "");
assert.equal(readDraft(storage, userA)?.business.name, "Activity A");
assert.equal(readDraft(storage, userB)?.business.name, "Activity B");

// Logout A clears only A
clearCompanyDrafts(storage, userA);
assert.equal(readDraft(storage, userA), null);
assert.equal(readDraft(storage, userB)?.business.name, "Activity B");
assert.ok(storage.getItem(PREVIEW_KEY), "preview store must remain");

console.log("PASS");
console.log("- draft keyed by user");
console.log("- logout A keeps B");
console.log("- missing userId clears nothing");
console.log("- preview storage stays independent");
