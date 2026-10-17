import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_ENV = "VELORA_SESSION_BROKER_KEY";

function loadKey(): Buffer | null {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

export function brokerEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export function sha256Buffer(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Short non-reversible fingerprint for logs — never the raw handle. */
export function boundaryFingerprint(handle: string): string {
  return sha256Buffer(handle).subarray(0, 8).toString("hex");
}

export function newOpaqueHandle(): string {
  return randomBytes(32).toString("base64url");
}

export function newGenerationId(): string {
  return randomBytes(16).toString("hex");
}

export function encryptSecret(plaintext: string, aad?: string): Buffer | null {
  const key = loadKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptSecret(blob: Buffer | Uint8Array, aad?: string): string | null {
  const key = loadKey();
  if (!key) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 28) return null;
  try {
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Context-bound admission handle encryption (C5-03). */
export function admissionHandleAad(input: {
  intentId: string | null;
  userId: string;
  nativeSessionId: string;
  lineageId: string;
  handleHashHex: string;
}): string {
  return [
    "admit-handle:v1",
    input.intentId ?? "",
    input.userId,
    input.nativeSessionId,
    input.lineageId,
    input.handleHashHex,
  ].join("|");
}

export function encryptAdmissionHandle(
  handle: string,
  ctx: Parameters<typeof admissionHandleAad>[0],
): string | null {
  const aad = admissionHandleAad(ctx);
  const buf = encryptSecret(handle, aad);
  return buf ? buf.toString("base64") : null;
}

export function decryptAdmissionHandle(
  encB64: string,
  ctx: Parameters<typeof admissionHandleAad>[0],
): string | null {
  try {
    return decryptSecret(Buffer.from(encB64, "base64"), admissionHandleAad(ctx));
  } catch {
    return null;
  }
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length || ab.length === 0) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
