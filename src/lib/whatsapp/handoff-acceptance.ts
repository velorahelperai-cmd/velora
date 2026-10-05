/**
 * Deferred acceptance cases for VEL-WA-HANDOFF-01.
 * Descriptors only — not executed; do not treat as PASS.
 */

export type HandoffAcceptanceCase = {
  id: string;
  title: string;
  expect: string;
};

export const HANDOFF_ACCEPTANCE_CASES: HandoffAcceptanceCase[] = [
  {
    id: "takeover-persists",
    title: "Take-over survives reload",
    expect: "After take_over, reload shows handed_over, automation_allowed=false, bumped generation/revision.",
  },
  {
    id: "cross-company-disabled-suspended",
    title: "Other company / disabled member / suspended company",
    expect: "control_whatsapp_conversation returns forbidden; no control column change.",
  },
  {
    id: "revision-conflict",
    title: "Stale revision conflict",
    expect: "Mismatched expected revision returns conflict with current state; no silent overwrite.",
  },
  {
    id: "takeover-invalidates-automation",
    title: "Staff take-over invalidates staged automation",
    expect: "automation_generation bumps; whatsapp_automation_gate + automationResultStillValid reject old generation.",
  },
  {
    id: "new-inbound-reopens-closed",
    title: "New inbound reopens resolved with AI still off",
    expect: "Inserted message on resolved → handed_over, automation_allowed=false; duplicate old message does not reopen.",
  },
  {
    id: "refresh-fail-no-repeat",
    title: "Refresh failure after successful control",
    expect: "UI warns and retries read only; does not call control_whatsapp_conversation again.",
  },
];

export const HANDOFF_ACCEPTANCE_STATUS = "deferred" as const;
