/**
 * Local isolation check: company draft storage must be keyed by user and cleared on logout/switch.
 * Does not touch velora_preview_v1 (language/preview remain independent).
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
    clear() {
      map.clear();
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

function clearDrafts(storage, userId) {
  if (userId) {
    storage.removeItem(keyFor(userId));
    return;
  }
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k?.startsWith(COMPANY_DRAFT_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => storage.removeItem(k));
}

function draftAllowedFor(draft, userId, companyId) {
  if (!draft || draft.userId !== userId) return false;
  if (companyId && draft.companyId && draft.companyId !== companyId) return false;
  return true;
}

const storage = createMemoryStorage();
storage.setItem(PREVIEW_KEY, JSON.stringify({ version: 1, viewAs: "owner", planInterest: "starter" }));

const userA = "user-a";
const userB = "user-b";
const draftA = emptyDraft(userA);
draftA.business.name = "Activity A";
draftA.business.hours = "9-5";
draftA.companyId = "company-a";
draftA.businessSaved = true;
writeDraft(storage, draftA);

assert.equal(readDraft(storage, userA)?.business.name, "Activity A");
assert.equal(readDraft(storage, userB), null);

// Logout / account switch clears company drafts, keeps preview + language store
clearDrafts(storage);
assert.equal(readDraft(storage, userA), null);
assert.ok(storage.getItem(PREVIEW_KEY), "preview store must remain");

// Account B starts empty; must not inherit A
const loadedB = readDraft(storage, userB);
assert.equal(loadedB, null);
const draftB = emptyDraft(userB);
assert.equal(draftB.business.name, "");
assert.equal(draftAllowedFor(draftA, userB, null), false);
assert.equal(draftAllowedFor(draftA, userA, "company-a"), true);
assert.equal(draftAllowedFor(draftA, userA, "company-other"), false);

writeDraft(storage, draftB);
assert.notEqual(readDraft(storage, userB)?.business.name, "Activity A");

console.log("PASS");
console.log("- draft keyed by user");
console.log("- logout clears company drafts only");
console.log("- account B does not inherit A");
console.log("- preview storage stays independent");
