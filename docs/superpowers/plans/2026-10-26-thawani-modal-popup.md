# Thawani modal and popup implementation plan

> For agentic workers: execute inline with superpowers:executing-plans. Preserve the canonical main checkout and exact file leases.

**Goal:** Keep review, payment status and recovery in one dialog; collect card details only in a Thawani popup, then navigate to authenticated plan setup after verified settlement and provisioning.
**Architecture:** Reuse SetupOrderReview and existing authenticated verification/provisioning actions. The popup return sends an untrusted same-origin wake-up hint and closes; only server verification grants paid state. Keep immutable order identity across retries.
**Tech stack:** Next16.4.2, React19.3, native dialog, same-origin BroadcastChannel with focus/poll fallback.
**Spec:** Human answer2026-10-26 accepts a small payment window with the rest of the journey in the dialog.

## Global constraints
Test only; existing allowlist/auth/session/provisioning boundaries unchanged. No new database schema, credentials or merchant configuration. No new order after UNKNOWN. Publication requires the next explicit delivery authorization. Existing unrelated channel UI changes remain separately owned and unpublished.

## Review focus
Popup blocked before checkout creation; user closes popup without paying; provider strips opener; stale account/unmount during verification; failed/unknown provisioning or unsafe redirect. Test each without treating a browser message as payment proof.

## Tasks
- [x] Add failing modal tests for blocked popup, same-order recovery, untrusted return hint, paid-only finish, stale account and cleanup.
- [x] Add managed review hooks without changing legacy redirect behavior. Integrate native modal over the existing plan screen.
- [x] Implement bounded single-flight server verification, explicit recovery and authenticated finish; open the provider window synchronously on the payment click with opener removed.
- [x] Add a return-only popup route and configure new provider sessions to use it. Preserve legacy payment-status recovery.
- [x] Run modal/review/preparation/provider tests, scoped lint/types and browser presentation checks; obtain review, save evidence and release leases. Do not claim hosted acceptance before an authorized deployment and actual Test journey.
