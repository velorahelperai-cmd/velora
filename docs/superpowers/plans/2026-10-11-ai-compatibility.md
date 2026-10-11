# AI runtime compatibility implementation plan

Goal: adopt missing durable customer runtime and administrative settlement contracts against the installed fixed-ack schema, with provider rollout off.
Architecture: additive frozen upgrade package; reuse canonical definitions only after dependency inspection. Bind each company budget and charged attempt to immutable subscription/version and Muscat period; preserve existing ledgers and histories.
Execution: sole writer on main, native execution; owner explicitly requested implementation without optional approval stalls.

- [ ] Inventory existing schema, canonical functions and privileges; create a separate network-isolated PostgreSQL clone of schema only.
- [ ] Write failing SQL regression cases for absent accounting contracts, immutable bindings, periods and forbidden actors.
- [ ] Implement narrow accounting compatibility plus version budget binding; no prices, budget values or activation seeded.
- [ ] Adapt worker contracts to installed locks and entitlement authority; preserve fixed-ack no-AI restriction.
- [ ] Verify tenant isolation, competing reservations, unknown outcomes, revocation, boundary periods and original history preservation in actual PostgreSQL.
- [ ] Independent source review, freeze hashes, exact production scope and forward recovery. Production application is outside this local execution turn.

Review focus: no customer actor impersonation; no service table overwrite privileges; no budget reset on plan changes; no unknown-outcome retry; no installer replay or historical data rewriting.
