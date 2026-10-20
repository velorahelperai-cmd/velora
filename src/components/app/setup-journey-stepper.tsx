import styles from "./setup-journey-stepper.module.css";

/** One visual/accessible contract for preparation, plan selection and review. */
export function SetupJourneyStepper({ ar, activeStep, className = "" }: {
  ar: boolean;
  activeStep: 1 | 2 | 3;
  className?: string;
}) {
  const labels = ar
    ? ["بيانات النشاط", "الباقة والمدة", "مراجعة الطلب"]
    : ["Business details", "Plan and term", "Order review"];
  return (
    <nav className={`${styles.stepper} ${className}`} dir={ar ? "rtl" : "ltr"} aria-label={ar ? "خطوات الإعداد" : "Setup steps"} data-setup-stepper="true" data-active-step={String(activeStep)}>
      <ol className={styles.list}>
        {labels.map((label, index) => (
          <li className={styles.step} key={index} data-step={index + 1} data-active={activeStep === index + 1} aria-current={activeStep === index + 1 ? "step" : undefined}>
            <span className={styles.circle} aria-hidden="true">{index + 1}</span>
            <span className={styles.label}>{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
