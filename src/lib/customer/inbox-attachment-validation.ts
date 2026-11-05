/** Shared server-side file admission for conversation attachments.
 * The database still performs its own independent size and signature checks.
 */
export function validInboxAttachment(name: unknown, mime: unknown, encoded: unknown): boolean {
  if (typeof name !== 'string' || !/^[\p{L}\p{N}_. -]{1,100}$/u.test(name) ||
      typeof mime !== 'string' || !['image/png', 'image/jpeg', 'application/pdf'].includes(mime) ||
      typeof encoded !== 'string' || encoded.length < 4 || encoded.length > 699052 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 1 || bytes.length > 524288 || bytes.toString('base64') !== encoded) return false;
  const signature = mime === 'image/png' ? '89504e470d0a1a0a' : mime === 'image/jpeg' ? 'ffd8ff' : '255044462d';
  return bytes.subarray(0, signature.length / 2).toString('hex') === signature;
}
