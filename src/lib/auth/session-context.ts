/** Cross-tab hints invalidate UI only. Cookies and server authorization remain authoritative. */
export const SESSION_CONTEXT_KEY = "velora_session_context_v1";
export type SessionContext = { userId: string; companyId: string | null };
export type SessionContextSignal =
  | ({ type: "context" } & SessionContext)
  | { type: "logout"; userId: string; boundaryFingerprint?: string | null }
  | { type: "quarantine"; userId: string; boundaryFingerprint: string | null };

const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function parse(raw: string | null): SessionContextSignal | null {
  try {
    const row = JSON.parse(raw ?? "null");
    if (!row || typeof row !== "object" || Array.isArray(row) || row.version !== 1 || !id(row.userId) || !id(row.nonce)) {
      return null;
    }
    const keys = Object.keys(row).sort().join(",");
    if (
      row.type === "logout"
      && (keys === "nonce,type,userId,version" || keys === "boundaryFingerprint,nonce,type,userId,version")
      && (row.boundaryFingerprint === null || row.boundaryFingerprint === undefined || id(row.boundaryFingerprint))
    ) {
      return {
        type: "logout",
        userId: row.userId,
        boundaryFingerprint: typeof row.boundaryFingerprint === "string" ? row.boundaryFingerprint : null,
      };
    }
    if (
      row.type === "quarantine"
      && (keys === "boundaryFingerprint,nonce,type,userId,version" || keys === "nonce,type,userId,version")
      && (row.boundaryFingerprint === null || row.boundaryFingerprint === undefined || id(row.boundaryFingerprint))
    ) {
      return {
        type: "quarantine",
        userId: row.userId,
        boundaryFingerprint: typeof row.boundaryFingerprint === "string" ? row.boundaryFingerprint : null,
      };
    }
    if (
      row.type === "context"
      && keys === "companyId,nonce,type,userId,version"
      && (row.companyId === null || id(row.companyId))
    ) {
      return { type: "context", userId: row.userId, companyId: row.companyId };
    }
  } catch {
    /* Corrupt or unrelated storage is never an auth signal. */
  }
  return null;
}

export function publishSessionContext(context: SessionContext, target: Window = window): void {
  try {
    const prior = parse(target.localStorage.getItem(SESSION_CONTEXT_KEY));
    if (prior?.type === "context" && prior.userId === context.userId && prior.companyId === context.companyId) {
      return;
    }
    target.localStorage.setItem(
      SESSION_CONTEXT_KEY,
      JSON.stringify({
        version: 1,
        type: "context",
        userId: context.userId,
        companyId: context.companyId,
        nonce: crypto.randomUUID(),
      }),
    );
  } catch {
    /* Identity works when storage is disabled. */
  }
}

export function publishSessionLogout(
  userId: string,
  boundaryFingerprintOrTarget?: string | null | Window,
  target?: Window,
): void {
  let boundaryFingerprint: string | null = null;
  let win = target;
  if (
    boundaryFingerprintOrTarget
    && typeof boundaryFingerprintOrTarget === "object"
    && "localStorage" in boundaryFingerprintOrTarget
  ) {
    win = boundaryFingerprintOrTarget as Window;
  } else if (typeof boundaryFingerprintOrTarget === "string") {
    boundaryFingerprint = boundaryFingerprintOrTarget;
  } else if (boundaryFingerprintOrTarget === null) {
    boundaryFingerprint = null;
  }
  try {
    win ??= typeof window === "undefined" ? undefined : window;
    if (!win) return;
    win.localStorage.setItem(
      SESSION_CONTEXT_KEY,
      JSON.stringify({
        version: 1,
        type: "logout",
        userId,
        boundaryFingerprint,
        nonce: crypto.randomUUID(),
      }),
    );
  } catch {
    /* Optional invalidation transport. */
  }
}

/** Persist opaque lock across reload/tabs. Never unlocks or grants authority. */
export function publishSessionQuarantine(
  userId: string,
  boundaryFingerprint: string | null,
  target: Window = window,
): void {
  try {
    target.localStorage.setItem(
      SESSION_CONTEXT_KEY,
      JSON.stringify({
        version: 1,
        type: "quarantine",
        userId,
        boundaryFingerprint,
        nonce: crypto.randomUUID(),
      }),
    );
  } catch {
    /* Storage unavailable must not silently restore locked A — server reattest required. */
  }
}

export function readLocalQuarantine(target: Window = window): SessionContextSignal | null {
  try {
    return parse(target.localStorage.getItem(SESSION_CONTEXT_KEY));
  } catch {
    return null;
  }
}

export function subscribeSessionContext(
  onSignal: (signal: SessionContextSignal) => void,
  target: Window = window,
): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== SESSION_CONTEXT_KEY) return;
    try {
      if (event.storageArea && event.storageArea !== target.localStorage) return;
    } catch {
      return;
    }
    const signal = parse(event.newValue);
    if (signal) onSignal(signal);
  };
  target.addEventListener("storage", listener);
  return () => target.removeEventListener("storage", listener);
}
