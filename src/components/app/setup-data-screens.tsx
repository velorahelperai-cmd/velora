import type { OnboardingAi, OnboardingCrm, OnboardingTeamRange, OnboardingWhatsAppPlatform } from "@/lib/tenancy/onboarding-answers";
import type { ChannelDraft } from "@/lib/tenancy/setup-data-steps";
import { workforceBadge } from "@/lib/tenancy/setup-data-steps";
import styles from "./setup-studio.module.css";

function ChannelMark({ id }: { id: "whatsapp" | "instagram" | "messenger" | "tiktok" }) {
  const props = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (id === "instagram") return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="12" cy="12" r="3.5" /><circle cx="17" cy="7" r=".8" fill="currentColor" stroke="none" /></svg>;
  if (id === "messenger") return <svg {...props}><path d="M12 4.5a7.5 7.5 0 0 0-7.5 7.2c0 2.3 1.1 4.3 2.9 5.6L6.5 20l2.6-1.4A7.6 7.6 0 0 0 12 19.2a7.5 7.5 0 0 0 0-14.7Z" /><path d="m8.2 13.2 2.2-2.4 1.7 1.6 2.7-2.6" /></svg>;
  if (id === "tiktok") return <svg {...props}><path d="M14 5v9.2a3.2 3.2 0 1 1-2.2-3" /><path d="M14 5c.4 2.2 2.1 3.8 4.4 4.1" /></svg>;
  return <svg {...props}><path d="M12 4.8a7 7 0 0 0-6.1 10.4L5 19.2l4.1-1.1A7 7 0 1 0 12 4.8Z" /><path d="M9 9.2c.2 2.4 1.8 4.2 4.2 4.6" /></svg>;
}

function Arrow({ forward }: { forward: "left" | "right" }) {
  const d = forward === "right" ? "M5 12h14m-6-6 6 6-6 6" : "M19 12H5m6-6-6 6 6 6";
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

const PLATFORMS: Array<[OnboardingWhatsAppPlatform, string, string]> = [
  ["BusinessApp", "تطبيق WhatsApp Business", "WhatsApp Business app"],
  ["Twilio", "Twilio", "Twilio"],
  ["Gupshup", "Gupshup", "Gupshup"],
  ["Infobip", "Infobip", "Infobip"],
  ["Sinch", "Sinch", "Sinch"],
  ["Bird", "Bird", "Bird"],
  ["360dialog", "360dialog", "360dialog"],
  ["other", "أخرى", "Other"],
];

export function SetupChannelStep({
  ar,
  draft,
  errors,
  onDraft,
  onBack,
  onContinue,
}: {
  ar: boolean;
  draft: ChannelDraft;
  errors: string[];
  onDraft: (next: ChannelDraft) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const yes = draft.existingUse === "yes";
  return (
    <section className={styles.stepCard} data-setup-step="channels" aria-labelledby="setup-channels-title">
      <h2 id="setup-channels-title">{t("أين يتواصل عملاؤك معك؟", "Where do customers reach you?")}</h2>
      <p>{t("اختر القنوات التي تحتاجها. الربط الفعلي بعد الدفع.", "Choose the channels you need. Connecting happens after payment.")}</p>
      <div className={`${styles.choiceGrid} ${styles.channelGrid}`} role="group" aria-label={t("القنوات", "Channels")} data-setup-channel-grid="true">
        <button type="button" className={styles.choice} data-channel="whatsapp" aria-pressed={draft.whatsapp} onClick={() => onDraft({ ...draft, whatsapp: !draft.whatsapp })}><ChannelMark id="whatsapp" />{t("واتساب", "WhatsApp")}</button>
        <button type="button" className={styles.choice} data-channel="instagram" aria-pressed={draft.instagram} onClick={() => onDraft({ ...draft, instagram: !draft.instagram })}><ChannelMark id="instagram" />{t("إنستغرام", "Instagram")}</button>
        <button type="button" className={styles.choice} data-channel-soon="messenger" disabled><ChannelMark id="messenger" />{t("ماسنجر", "Messenger")}<span>{t("قريبًا", "Soon")}</span></button>
        <button type="button" className={styles.choice} data-channel-soon="tiktok" disabled><ChannelMark id="tiktok" />{t("تيك توك", "TikTok")}<span>{t("قريبًا", "Soon")}</span></button>
      </div>
      {draft.whatsapp ? (
        <div className={styles.conditional} data-whatsapp-setup="true">
          <h3>{t("إعداد واتساب", "WhatsApp setup")}</h3>
          <div role="radiogroup" aria-required="true" aria-label={t("هل تستخدم واتساب للأعمال حاليًا؟", "Do you use WhatsApp for business today?")}>
            <span>{t("هل تستخدم واتساب للأعمال حاليًا؟", "Do you use WhatsApp for business today?")}</span>
            {(["yes", "no"] as const).map((value) => (
              <button key={value} type="button" role="radio" data-whatsapp-existing={value} aria-checked={draft.existingUse === value} onClick={() => onDraft({ ...draft, existingUse: value })}>
                {value === "yes" ? t("نعم", "Yes") : t("لا", "No")}
              </button>
            ))}
          </div>
          {yes ? (
            <>
              <label htmlFor="setup-wa-platform">{t("على أي منصة؟", "Which platform?")}</label>
              <select id="setup-wa-platform" value={draft.platform} aria-invalid={errors.includes("platform") || undefined} onChange={(event) => onDraft({ ...draft, platform: event.target.value as OnboardingWhatsAppPlatform | "" })}>
                <option value="">{t("اختر المنصة", "Choose a platform")}</option>
                {PLATFORMS.map(([id, arLabel, enLabel]) => <option key={id} value={id}>{ar ? arLabel : enLabel}</option>)}
              </select>
              {draft.platform === "BusinessApp" ? <p>{t("التحقق من أهلية الربط مع التطبيق الحالي يتم لاحقًا، وهذا ليس موافقة على التعايش.", "Eligibility to connect the current app is checked later. This is not a coexistence approval.")}</p> : null}
              {draft.platform && draft.platform !== "BusinessApp" ? <p>{t("تقييم الانتقال من مزود آخر مستقل عن أهلية تطبيق الأعمال.", "A move from another provider is assessed separately from Business App coexistence.")}</p> : null}
              {draft.platform === "other" ? (
                <input aria-label={t("اسم المنصة", "Platform name")} maxLength={80} value={draft.platformOther} onChange={(event) => onDraft({ ...draft, platformOther: event.target.value })} />
              ) : null}
              <div role="radiogroup" aria-label={t("هل نشاطك موثّق لدى ميتا؟", "Is your business verified with Meta?")}>
                <span>{t("هل نشاطك موثّق لدى ميتا؟", "Is your business verified with Meta?")}</span>
                {([["yes", "موثّق", "Verified"], ["no", "غير موثّق", "Not verified"], ["unknown", "لا أعرف", "I do not know"]] as const).map(([value, arLabel, enLabel]) => (
                  <button key={value} type="button" role="radio" data-whatsapp-verification={value} aria-checked={draft.verification === value} onClick={() => onDraft({ ...draft, verification: value })}>{ar ? arLabel : enLabel}</button>
                ))}
              </div>
              <div role="radiogroup" aria-label={t("هل لديك حساب فيسبوك أو حساب ميتا للأعمال؟", "Do you have a Facebook or Meta business account?")}>
                <span>{t("هل لديك حساب فيسبوك أو حساب ميتا للأعمال؟", "Do you have a Facebook or Meta business account?")}</span>
                {(["yes", "no"] as const).map((value) => (
                  <button key={value} type="button" role="radio" data-whatsapp-facebook={value} aria-checked={draft.facebook === value} onClick={() => onDraft({ ...draft, facebook: value })}>{value === "yes" ? t("نعم", "Yes") : t("لا", "No")}</button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {errors.length ? <p role="alert">{t("أكمل أسئلة واتساب الظاهرة قبل المتابعة.", "Answer the visible WhatsApp questions before continuing.")}</p> : null}
      <p>{t("لا نربط أي حساب في هذه الخطوة.", "No account is connected in this step.")}</p>
      <div className={styles.stepActions}>
        <button type="button" className={styles.back} data-setup-back="true" onClick={onBack}>
          <Arrow forward={ar ? "right" : "left"} />
          {t("السابق: نشاطك", "Back: Your activity")}
        </button>
        <button type="button" className={styles.primary} data-setup-continue="true" data-setup-destination="goals" onClick={onContinue}>
          {t("التالي: أهدافك", "Next: Your goals")}
          <Arrow forward={ar ? "left" : "right"} />
        </button>
      </div>
    </section>
  );
}

const CRM: Array<[OnboardingCrm, string, string]> = [
  ["Shopify", "Shopify", "Shopify"],
  ["WooCommerce", "WooCommerce", "WooCommerce"],
  ["HubSpot", "HubSpot", "HubSpot"],
  ["Salesforce", "Salesforce", "Salesforce"],
  ["Zoho", "Zoho", "Zoho"],
  ["Sheets", "Google Sheets", "Google Sheets"],
  ["other", "أخرى", "Other"],
  ["none", "لا أحفظها", "I do not keep them"],
];
const AI: Array<[OnboardingAi, string, string]> = [
  ["ChatGPT", "ChatGPT", "ChatGPT"],
  ["Gemini", "Gemini", "Gemini"],
  ["Claude", "Claude", "Claude"],
  ["Copilot", "Microsoft Copilot", "Microsoft Copilot"],
  ["other", "أخرى", "Other"],
  ["exploring", "ما زلت أستكشف", "I am still exploring"],
];
const RANGES: Array<[OnboardingTeamRange, string]> = [["1-3", "1–3"], ["4-10", "4–10"], ["11-25", "11–25"], [">25", ">25"]];

export function SetupGoalStep({
  ar,
  goals,
  range,
  crm,
  crmOther,
  ai,
  aiOther,
  errors,
  onGoal,
  onRange,
  onCrm,
  onCrmOther,
  onAi,
  onAiOther,
  onBack,
  onContinue,
}: {
  ar: boolean;
  goals: string[];
  range: OnboardingTeamRange | null;
  crm: OnboardingCrm | null;
  crmOther: string;
  ai: OnboardingAi | null;
  aiOther: string;
  errors: string[];
  onGoal: (goal: string) => void;
  onRange: (range: OnboardingTeamRange) => void;
  onCrm: (choice: OnboardingCrm) => void;
  onCrmOther: (value: string) => void;
  onAi: (choice: OnboardingAi) => void;
  onAiOther: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const badge = workforceBadge(range);
  const badgeName = badge === "level_1" ? t("نورا", "Noura") : badge === "level_2" ? t("لينا", "Lina") : badge === "level_3" ? t("دانا", "Dana") : "";
  const goalsList = [
    ["support", "دعم العملاء", "Customer support"],
    ["sales", "المبيعات", "Sales"],
    ["marketing", "التسويق", "Marketing"],
    ["bookings", "الحجوزات والمواعيد", "Bookings and appointments"],
    ["orders", "استقبال الطلبات", "Receiving orders"],
  ] as const;
  return (
    <section className={styles.stepCard} data-setup-step="goals" aria-labelledby="setup-goals-title">
      <h2 id="setup-goals-title">{t("ما الذي تريد إنجازه مع Velora؟", "What do you want to accomplish with Velora?")}</h2>
      <p>{t("أخبرنا بأهدافك لنساعدك في تهيئة تجربتك بشكل أفضل.", "Tell us your goals so we can prepare your experience.")}</p>
      <p id="setup-goals-label">{t("أهدافك", "Your goals")} <span className={styles.req}>{t("مطلوب", "Required")}</span></p>
      <div role="group" aria-labelledby="setup-goals-label" aria-describedby={errors.includes("goals") ? "setup-goals-error" : undefined} className={styles.choiceGrid}>
        {goalsList.map(([id, arLabel, enLabel]) => (
          <button key={id} type="button" className={styles.choice} data-goal={id} aria-pressed={goals.includes(id)} onClick={() => onGoal(id)}>{ar ? arLabel : enLabel}</button>
        ))}
      </div>
      <div role="radiogroup" aria-required="true" aria-label={t("كم شخصًا يعمل في نشاطك إجمالًا؟", "How many people work in your business in total?")} className={styles.choiceGrid}>
        <p>{t("كم شخصًا يعمل في نشاطك إجمالًا؟", "How many people work in your business in total?")}</p>
        <p>{t("يشمل فريق النشاط في جميع الفروع، وليس عدد حسابات Velora.", "This includes the whole business across all branches, not licensed Velora users.")}</p>
        {RANGES.map(([id, label]) => (
          <button key={id} type="button" role="radio" className={styles.choice} data-team-range={id} aria-checked={range === id} onClick={() => onRange(id)}>{id === ">25" ? t("أكثر من 25", "More than 25") : <span className={styles.numericRange} dir="ltr">{label}</span>}</button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t("أين تحفظ بيانات عملائك؟", "Where do you keep customer data?")} className={styles.choiceGrid}>
        <p>{t("أين تحفظ بيانات عملائك؟", "Where do you keep customer data?")} <span>{t("اختياري", "Optional")}</span></p>
        {CRM.map(([id, arLabel, enLabel]) => (
          <button key={id} type="button" role="radio" data-crm={id} aria-checked={crm === id} onClick={() => onCrm(id)}>{ar ? arLabel : enLabel}</button>
        ))}
        {crm === "other" ? <input aria-label={t("نظام آخر", "Other system")} maxLength={80} value={crmOther} onChange={(event) => onCrmOther(event.target.value)} /> : null}
      </div>
      <div role="radiogroup" aria-label={t("ما أدوات الذكاء الاصطناعي التي تستخدمها حاليًا؟", "Which AI tools do you use today?")} className={styles.choiceGrid}>
        <p>{t("ما أدوات الذكاء الاصطناعي التي تستخدمها حاليًا؟", "Which AI tools do you use today?")} <span>{t("اختياري", "Optional")}</span></p>
        {AI.map(([id, arLabel, enLabel]) => (
          <button key={id} type="button" role="radio" data-ai={id} aria-checked={ai === id} onClick={() => onAi(id)}>{ar ? arLabel : enLabel}</button>
        ))}
        {ai === "other" ? <input aria-label={t("أداة أخرى", "Other tool")} maxLength={80} value={aiOther} onChange={(event) => onAiOther(event.target.value)} /> : null}
      </div>
      <p data-workforce-badge={badge ?? "none"}>
        {badge ? t(`نقترح ${badgeName} لفريقك.`, `We suggest ${badgeName} for your team.`) : t("يظهر اقتراح الشخصية بعد اختيار حجم الفريق.", "The persona suggestion appears after you choose the team size.")}
        {" "}{t("اقتراح للشخصية فقط، والاختيار لك.", "This suggests a persona only. The choice is yours.")}
      </p>
      <p>{t("لكل فرع، القياسية تشمل المالك وموظفين وقناة واحدة، والمميزة تشمل المالك و4 موظفين وقناتين. الشارة لا تزيد هذا الحد.", "Per branch, Standard includes the owner, 2 employees and 1 channel. Premium includes the owner, 4 employees and 2 channels. The badge does not raise that limit.")}</p>
      {errors.length ? <p id="setup-goals-error" role="alert">{t("اختر هدفًا واحدًا على الأقل وحجم الفريق.", "Choose at least one goal and the team size.")}</p> : null}
      <div className={styles.stepActions}>
        <button type="button" className={styles.back} data-setup-back="true" onClick={onBack}>
          <Arrow forward={ar ? "right" : "left"} />
          {t("السابق: قنواتك", "Back: Your channels")}
        </button>
        <button type="button" className={styles.primary} data-setup-continue="true" data-setup-destination="plans" onClick={onContinue}>
          {t("التالي: قابل فريقك", "Next: Meet your team")}
          <Arrow forward={ar ? "left" : "right"} />
        </button>
      </div>
    </section>
  );
}
