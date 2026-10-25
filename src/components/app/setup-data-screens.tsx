"use client";

import type { ChannelDraft } from "@/lib/tenancy/setup-data-steps";
import styles from "./setup-studio.module.css";

/** Activity-step WhatsApp Business use question (yes/no). Channel cards removed from this flow. */
export function SetupWhatsAppExistingQuestion({
  ar,
  draft,
  onDraft,
  error,
}: {
  ar: boolean;
  draft: ChannelDraft;
  onDraft: (next: ChannelDraft) => void;
  error?: boolean;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const label = t("هل تستخدم واتساب للأعمال حاليًا؟", "Do you use WhatsApp for business today?");
  return (
    <div className={styles.whatsappExisting} data-setup-whatsapp-existing="true">
      <div
        role="radiogroup"
        aria-required="true"
        aria-invalid={error || undefined}
        aria-label={label}
        className={styles.whatsappExistingRow}
      >
        <span className={styles.whatsappExistingLabel}>{label}</span>
        <div className={styles.whatsappExistingChoices}>
          {(["yes", "no"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className={styles.choice}
              data-whatsapp-existing={value}
              aria-checked={draft.existingUse === value}
              onClick={() => onDraft({ ...draft, whatsapp: true, existingUse: value })}
            >
              {value === "yes" ? t("نعم", "Yes") : t("لا", "No")}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{t("أجب عن سؤال واتساب للأعمال قبل المتابعة.", "Answer the WhatsApp for Business question before continuing.")}</p> : null}
    </div>
  );
}

const GOALS = [
  ["support", "دعم العملاء", "Customer support"],
  ["sales", "المبيعات", "Sales"],
  ["marketing", "التسويق", "Marketing"],
  ["bookings", "الحجوزات والمواعيد", "Bookings and appointments"],
  ["orders", "استقبال الطلبات", "Receiving orders"],
] as const;

/** Goals choice embedded in the activity identity step (no separate أهدافك / team-size step). */
export function SetupActivityGoals({
  ar,
  goals,
  errors,
  onGoal,
}: {
  ar: boolean;
  goals: string[];
  errors: string[];
  onGoal: (goal: string) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const goalsMissing = errors.includes("goals");
  return (
    <div className={styles.activityGoals} data-setup-activity-goals="true">
      <div
        role="group"
        aria-labelledby="setup-goals-title"
        aria-describedby={goalsMissing ? "setup-goals-error" : undefined}
        className={styles.activityGoalsRow}
      >
        <h2 id="setup-goals-title" className={styles.activityGoalsTitle}>
          {t("ما الذي تريد إنجازه مع Velora؟", "What do you want to accomplish with Velora?")}
        </h2>
        <div className={styles.choiceGrid}>
          {GOALS.map(([id, arLabel, enLabel]) => (
            <button
              key={id}
              type="button"
              className={styles.choice}
              data-goal={id}
              aria-pressed={goals.includes(id)}
              onClick={() => onGoal(id)}
            >
              {ar ? arLabel : enLabel}
            </button>
          ))}
        </div>
      </div>
      {goalsMissing ? (
        <p id="setup-goals-error" className={styles.error} role="alert">
          {t("اختر هدفًا واحدًا على الأقل.", "Choose at least one goal.")}
        </p>
      ) : null}
    </div>
  );
}
