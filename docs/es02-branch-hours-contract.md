# ES02 stage4 B4: branch-bound authoritative hours

Status: stable ownership/API contract; B4 implemented.

## Stable Server Action boundary

Exports from `src/lib/tenancy/branch-hours-actions.ts`:
- `readOwnedBranchHoursAction(scope: BranchHoursScope): Promise<BranchHoursReadResult>`
- `saveOwnedBranchHoursAction(draft: BranchHoursSaveDraft): Promise<BranchHoursSaveResult>`
- `copyOwnedBranchHoursAction(draft: BranchHoursCopyDraft): Promise<BranchHoursCopyResult>`

Data Types (from `src/lib/tenancy/branch-hours-contracts.ts` and `branch-hours-service-contracts.ts`):
- `BranchHoursScope = { expectedAccountId: string; companyId: string; branchId: string }`
- `BranchHoursSnapshot = { scope: BranchHoursScope; version: number; branchLabel: string; timezone: string | null; schedule: BranchHoursSchedule }`
- `BranchHoursCopyTarget = { branchId: string; label: string; timezone: string | null; version: number }`
- `BranchHoursSaveDraft = { scope: BranchHoursScope; expectedVersion: number; schedule: BranchHoursSchedule }`
- `BranchHoursCopyDraft = { source: BranchHoursSaveDraft; mode: 'local-weekday-clock'; targets: { branchId: string; expectedVersion: number }[] }`

## Native invariants

1. Authority check passes through `public.es02_read_owned_branch_setup(expectedAccountId, companyId, branchId)` before any row manipulation.
2. Private tables:
   - `private.es02_branch_hours(company_id, branch_id, schedule, revision, created_at, updated_at)`
   - `private.es02_branch_hours_receipts(id, company_id, branch_id, revision, fingerprint, created_at)`
3. Idempotent retry: matching payload with expected revision returns existing committed revision without duplicate version increment.
4. Timezone changes trigger revision invalidation via `private.es02_branch_hours_timezone_invalidation()`.
5. Fail-closed: invalid timezones, non-matching revisions, or lack of paid ownership return typed errors (`conflict`, `unknown_timezone`, `forbidden`, `unpaid`, `suspended`, `not_provisioned`).
