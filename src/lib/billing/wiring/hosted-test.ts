import "server-only";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Server configuration only. No client/callback fields can select a trial actor. */
export function hostedTestActorAllowed(accountId: unknown, companyId: unknown): boolean {
  const account = process.env.PAYMOB_HOSTED_TEST_ACCOUNT_ID?.trim();
  const company = process.env.PAYMOB_HOSTED_TEST_COMPANY_ID?.trim();
  return process.env.BILLING_PAYMOB_HOSTED_TEST_ENABLED === "true" &&
    !!account && !!company && UUID.test(account) && UUID.test(company) &&
    accountId === account && companyId === company;
}
export function hostedTestCompanyAllowed(companyId: unknown): boolean {
  return hostedTestActorAllowed(process.env.PAYMOB_HOSTED_TEST_ACCOUNT_ID?.trim(), companyId);
}
