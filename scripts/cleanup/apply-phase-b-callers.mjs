import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const next = fn(s);
  if (next === s) console.log(`UNCHANGED:${file}`);
  else {
    fs.writeFileSync(file, next);
    console.log(`PATCHED:${file}`);
  }
}

patch("src/app/setup/page.tsx", (s) =>
  s
    .replace(/import \{smartOnboardingEnabled\} from '@\/lib\/tenancy\/smart-rollout';\r?\n/, "")
    .replace(/\s*smartOnboardingEnabled=\{smartOnboardingEnabled\(\)\}\r?\n/, "\n"),
);

patch("src/lib/tenancy/actions.ts", (s) =>
  s
    .replace(/import \{smartOnboardingEnabled\} from '\.\/smart-rollout';\r?\n/, "")
    .replace(/masterJourneyEnabled\(\)\|\|smartOnboardingEnabled\(\)/g, "masterJourneyEnabled()"),
);

patch("src/components/app/settings.tsx", (s) =>
  s
    .replace(/import \{RenewalWalletPanel\} from '\.\/renewal-wallet-panel';\r?\n/, "")
    .replace(
      /\s*\{masterJourneyEnabled&&initialAccess\.userId&&initialAccess\.companyId&&<RenewalWalletPanel[\s\S]*?\/>\}/,
      "",
    ),
);

patch("src/lib/business-types.test.ts", (s) =>
  s
    .replace(/import \{parseSmartStartStorage\} from '\.\/tenancy\/smart-business-start-storage';\r?\n/, "")
    .replace(
      /it\('preserves old, expanded and custom values through existing profile and creation recovery validators',[\s\S]*?\}\);\r?\n/,
      "",
    ),
);

patch("src/components/app/setup-wizard.tsx", (s) => {
  s = s
    .replace(/import \{KnowledgeImportReview\} from '\.\/knowledge-import-review';\r?\n/, "")
    .replace(/import \{ SmartSetupCards \} from "\.\/smart-setup-cards";\r?\n/, "")
    .replace(/import \{ SmartSetupBranches \} from "\.\/smart-setup-branches";\r?\n/, "")
    .replace(/import \{ SmartSettingsPanel \} from '\.\/smart-settings-panel';\r?\n/, "")
    .replace(/import \{ SmartBusinessStart \} from '\.\/smart-business-start';\r?\n/, "")
    .replace(
      /import \{ readSmartSetup, type SmartSetupRead \} from "@\/lib\/tenancy\/smart-onboarding-actions";\r?\n/,
      "",
    )
    .replace(
      /import \{ buildSmartOnboarding, type SmartSetupCard \} from "@\/lib\/tenancy\/smart-onboarding";\r?\n/,
      "",
    )
    .replace(/import \{buildSetupPageView,setupPageStep\} from "\.\/setup-page-view";\r?\n/, "")
    .replace(/\s*smartOnboardingEnabled = false,\r?\n/, "\n")
    .replace(/\s*smartOnboardingEnabled\?: boolean;\r?\n/, "\n");

  s = s.replace(
    /\s*const \[openPanel,setOpenPanel\] = useState<number\|"branches"\|null>\(null\);\r?\n[\s\S]*?\},\[userId,companyId,savedCompany\?\.updated_at,smartRetry,smartOnboardingEnabled,currentSmartScope,smartReadActorScope\]\);\r?\n/,
    "\n  const [openPanel,setOpenPanel] = useState<number|null>(null);\n",
  );

  s = s
    .replace(
      /const step = smartOnboardingEnabled\?setupPageStep\(draft\.setupStep\):Math\.max\(0, Math\.min\(7, draft\.setupStep\)\);/,
      "const step = Math.max(0, Math.min(7, draft.setupStep));",
    )
    .replace(
      /const visiblePanel=openPanel===null\|\|openPanel==="branches"\?openPanel:smartOnboardingEnabled\?setupPageStep\(openPanel\):openPanel;/,
      "const visiblePanel=openPanel;",
    )
    .replace(
      /const next = smartOnboardingEnabled\?setupPageStep\(n\):Math\.max\(0, Math\.min\(7, n\)\);/,
      "const next = Math.max(0, Math.min(7, n));",
    );

  s = s.replace(
    /\s*const smart=buildSmartOnboarding\([\s\S]*?\);\r?\n\s*const pageView=buildSetupPageView\(smart,savedCompany,smartRead\?\.branchSetup\?\?null\);\r?\n\s*const closePanel=\(\)=>\{if\(leaveGuardRef\.current&&!leaveGuardRef\.current\(\)\)return;setOpenPanel\(null\);\};\r?\n\s*const openCard=\(card:SmartSetupCard\)=>\{[\s\S]*?\};\r?\n/,
    "\n  const closePanel=()=>{if(leaveGuardRef.current&&!leaveGuardRef.current())return;setOpenPanel(null);};\n",
  );

  s = s
    .replace(/ data-first-business=\{smartOnboardingEnabled&&!companyId\?"true":undefined\}/, "")
    .replace(
      /\{smartOnboardingEnabled\?<>\{pageView\.completedRequired\} \/ \{pageView\.totalRequired\} \{ar \? "بيانات الصفحة المكتملة" : "page data completed"\}<\/>:<>\{effectiveSetupDone\.filter\(Boolean\)\.length\} \/ 8 \{ar\?"محطات مؤكدة من السجلات":"milestones confirmed from records"\}<\/>\}/,
      '{effectiveSetupDone.filter(Boolean).length} / 8 {ar?"محطات مؤكدة من السجلات":"milestones confirmed from records"}',
    )
    .replace(
      /\{smartOnboardingEnabled&&!companyId\?\(ar\?"ابدأ بتعريف نشاطك، ثم أكمل إعداد موظفتك الرقمية.":"Introduce your business, then set up your digital employee."\):<>\{!smartOnboardingEnabled\?`\$\{fill\(mCopy\.milestoneProgress,\{n:step\+1\}\)\} · `:""\}\{copy\.setup\.resume\}<\/>\}/,
      "<>{`${fill(mCopy.milestoneProgress,{n:step+1})} · `}{copy.setup.resume}</>",
    )
    .replace(/dataPage=\{smartOnboardingEnabled\}/, "dataPage={false}");

  s = s.replace(
    /\{smartOnboardingEnabled\?\(companyId \? null : <SmartBusinessStart key=\{userId\} userId=\{userId\} ar=\{ar\} onCreated=\{adoptCompany\}\/>\):<><SetupNavigation[\s\S]*?<\/div><\/>\}/,
    '<><SetupNavigation labels={mCopy.steps} shortLabels={ar?["الشركة","الاشتراك","ساعات العمل","المعرفة","لغة الرد","واتساب","التجربة","المراجعة"]:["Company","Subscription","Hours","Knowledge","Reply language","WhatsApp","Trial","Review"]} done={effectiveSetupDone} step={step} locale={locale} onSelect={go}/><div className={styles.progress} aria-hidden="true"><div className={styles.progressFill} style={{width:`${Math.round(effectiveSetupDone.filter(Boolean).length/8*100)}%`}}/></div></>',
  );

  s = s.replace(
    /\{smartOnboardingEnabled&&companyId&&smartLoad==="failed"\?<Notice[\s\S]*?<\/Notice>:null\}\r?\n/,
    "",
  );

  s = s.replace(
    /\s*<SmartSetupCards enabled=\{smartOnboardingEnabled&&!!companyId\} locale=\{locale\} \{\.\.\.pageView\} progressKind="page" onOpen=\{openCard\} onClose=\{closePanel\}\r?\n\s*activeCardId=\{visiblePanel==='branches'\?'branches':pageView\.cards\.find\(card=>card\.step!==null&&card\.step===visiblePanel\)\?\.id\?\?null\}>\r?\n/,
    "\n        <>\n",
  );

  s = s.replace(
    /\{\(!smartOnboardingEnabled\|\|companyId&&visiblePanel!==null\)\?<section/,
    "{true?<section",
  );

  s = s.replace(/\{visiblePanel==="branches"\?[\s\S]*?:<>/, "<>");

  s = s
    .replace(
      /\{!smartOnboardingEnabled\?<span className=\{styles\.stepHeadingNumber\}>\{step\+1\}<\/span>:null\}/,
      "<span className={styles.stepHeadingNumber}>{step+1}</span>",
    )
    .replace(
      /\{smartOnboardingEnabled&&savedCompany&&\[0,2,4\]\.includes\(step\)\?<SmartSettingsPanel[\s\S]*?\/>:null\}\r?\n/,
      "",
    )
    .replace(/\{!smartOnboardingEnabled&&step === /g, "{step === ")
    .replace(/\{masterJourneyEnabled&&<KnowledgeImportReview[\s\S]*?\/>\}/, "")
    .replace(/go\(smartOnboardingEnabled\?7:2\)/g, "go(2)")
    .replace(/onBack=\{\(\) => go\(smartOnboardingEnabled\?1:6\)\}/g, "onBack={() => go(6)}")
    .replace(/pageScope=\{smartOnboardingEnabled\}/g, "pageScope={false}")
    .replace(/selectedChannels=\{smartOnboardingEnabled\?smart\.selectedChannels:null\}/g, "selectedChannels={null}")
    .replace(
      /reviewConfigured=\{!smartOnboardingEnabled\|\|smartRead\?\.reviewPolicyEnabled===true\}/g,
      "reviewConfigured={true}",
    )
    .replace(/\s*<\/SmartSetupCards>/, "\n        </>");

  return s;
});

// Remaining broken imports
for (const file of [
  "src/components/app/setup-file-preparation.tsx",
  "src/components/app/business-financial-rights-panel.tsx",
  "src/app/setup/prepayment-route.test.tsx",
  "src/app/setup/route-navigation.test.tsx",
  "src/components/app/setup-review-prerequisites.test.tsx",
]) {
  if (!fs.existsSync(file)) continue;
  const s = fs.readFileSync(file, "utf8");
  if (
    /smart-rollout|smart-onboarding|smart-business|knowledge-import-review|renewal-wallet|business-archive|use-smart-autosave|setup-page-view|cycle-cost-actions|cycle-costs-panel/.test(
      s,
    )
  ) {
    console.log(`REMAINING_REF:${file}`);
  }
}
