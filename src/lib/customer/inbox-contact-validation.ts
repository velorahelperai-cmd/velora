/** Pure admission for a saved customer email and location.
 * The database still checks the same limits before it stores a profile.
 */
const contactEmail = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export function validInboxContact(email: string, location: string) {
  const mail = email.trim();
  const place = location.trim();
  if (mail.length > 254 || place.length > 120 || mail.includes('\0') || place.includes('\0')) return false;
  return mail === '' || contactEmail.test(mail);
}
