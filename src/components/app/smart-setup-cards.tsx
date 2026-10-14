'use client';
import type {SmartSetupCard,SetupCardId,SetupStatus} from '@/lib/tenancy/smart-onboarding';
import styles from './smart-setup.module.css';

const copy={
 ar:{title:'جهّز نشاطك على راحتك',body:'ابدأ بما تحتاجه الآن. إعداداتك محفوظة في حسابك، ويمكنك إكمالها لاحقًا.',progress:'جاهزية التجهيز',optional:'اختياري',required:'مطلوب',action:'فتح الإعدادات',missing:'المتبقي',
  status:{not_started:'لم يبدأ',in_progress:'قيد التجهيز',needs_attention:'يحتاج متابعة',ready:'جاهز',active:'فعّال',failed:'تعذر التحقق'},
  cards:{profile:['معلومات النشاط','الاسم ونوع النشاط والدولة. أضف بيانات التواصل عند الحاجة.'],branches:['إدارة الفروع','فرع رئيسي لكل نشاط، مع إمكانية إضافة فروع أخرى لاحقًا.'],knowledge:['معرفة المساعد','معلوماتك وأسئلتك وملفاتك، مع مراجعتها قبل اعتمادها.'],language:['لغة وأسلوب الرد','حدد لغة الرد، وأضف أسلوبك إلى تعليمات النشاط المعتمدة.'],hours:['ساعات العمل','أضف أوقات الدوام عندما تحتاجها إجابات المساعد.'],trial:['تجربة المحادثة','جرّب إجابات المساعد قبل استقبال محادثات العملاء.'],channels:['ربط القنوات','اختر قنواتك، ثم اربط كل قناة وتحقق من جاهزيتها.'],subscription:['الباقة والدفع','استعرض الباقات. إنشاء النشاط لا يبدأ اشتراكًا مدفوعًا.'],review:['مراجعة جاهزية التشغيل','راجع متطلبات التشغيل واطلب اعتماد النشاط عند اكتمالها.']},
  reasons:{profile:'أكمل اسم النشاط ونوعه والدولة.',branches:'أكد عدد الفروع واسم الفرع الرئيسي.',knowledge:'أضف المعرفة وراجع اعتمادها.',language:'حدد لغة الرد.',hours:'يمكن إضافة ساعات العمل لاحقًا.',trial:'يمكنك تجربة المحادثة عندما تكون المعرفة جاهزة.',unavailable:'تعذر قراءة حالة القنوات. أعد المحاولة.',channel_policy:'توزيع القنوات لهذه الباقة ينتظر الإعداد المعتمد.',channel_selection:'اختر القنوات المشمولة بالباقة.',channel_verification:'تحقق من الأذونات والاستقبال والإرسال وشروط تشغيل كل قناة.',subscription:'اختر الباقة وأكمل الدفع عند استعدادك.',review:'يلزم اعتماد حديث يستند إلى إعدادات النشاط الحالية.'}},
 en:{title:'Prepare your business at your pace',body:'Start with what you need today. Your settings are saved to your account and can be completed later.',progress:'Setup readiness',optional:'Optional',required:'Required',action:'Open settings',missing:'Remaining',
  status:{not_started:'Not started',in_progress:'In progress',needs_attention:'Needs attention',ready:'Ready',active:'Active',failed:'Could not verify'},
  cards:{profile:['Business information','Name, business type and country. Add contact details when needed.'],branches:['Manage branches','A main branch for each business, with more branches available later.'],knowledge:['Assistant knowledge','Your information, questions and files, reviewed before approval.'],language:['Reply language and style','Choose a reply language and add your style to approved business instructions.'],hours:['Working hours','Add opening hours when assistant answers need them.'],trial:['Try a conversation','Try assistant answers before handling customer conversations.'],channels:['Connect channels','Choose your channels, then connect and verify each channel.'],subscription:['Plan and payment','Explore plans. Creating a business does not start a paid subscription.'],review:['Review launch readiness','Review operational requirements and request approval when ready.']},
  reasons:{profile:'Complete the business name, type and country.',branches:'Confirm branch count and the main branch name.',knowledge:'Add knowledge and check its approval.',language:'Choose a reply language.',hours:'Working hours can be added later.',trial:'Try a conversation when your knowledge is ready.',unavailable:'Channel status could not be loaded. Retry.',channel_policy:'Channel allocation for this plan awaits approved configuration.',channel_selection:'Select the channels included in your plan.',channel_verification:'Verify permissions, receiving, sending and operational requirements for each channel.',subscription:'Choose a plan and complete payment when ready.',review:'Current approval must reflect the latest business settings.'}},
};

export function SmartSetupCards({locale,cards,percent,completedRequired,totalRequired,onOpen}:{locale:'ar'|'en';cards:SmartSetupCard[];percent:number;completedRequired:number;totalRequired:number;onOpen:(card:SmartSetupCard)=>void}){
 const c=copy[locale];
 return <section className={styles.dashboard} aria-labelledby="smart-setup-heading">
  <div className={styles.intro}><div><h2 id="smart-setup-heading">{c.title}</h2><p>{c.body}</p></div><div className={styles.progressSummary}><strong>{percent}%</strong><span>{c.progress} · {completedRequired}/{totalRequired}</span></div></div>
  <div className={styles.progress} role="progressbar" aria-label={c.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{width:`${percent}%`}} /></div>
  <div className={styles.cards}>{cards.map(card=>{
   const [title,body]=c.cards[card.id as SetupCardId];
   const reason=card.missing==='branch_pending'?(locale==='ar'?'الفروع الإضافية المحفوظة تنتظر تجهيز نطاق التشغيل.':'Saved secondary branches await their operational setup.'):card.missing==='review_configuration'?(locale==='ar'?'مراجعة الرحلة الجديدة تنتظر الإعداد المعتمد.':'The new review flow awaits approved configuration.'):c.reasons[card.missing as keyof typeof c.reasons];
   return <article className={styles.card} key={card.id}>
    <div className={styles.cardTop}><span className={styles.status} data-status={card.status}>{c.status[card.status as SetupStatus]}</span><span className={styles.requirement}>{card.required?c.required:c.optional}</span></div>
    <h3>{title}</h3><p>{body}</p>
    <p className={styles.remaining}>{card.missing?<><strong>{c.missing}: </strong>{reason}</>:c.status[card.status]}</p>
    <button type="button" onClick={()=>onOpen(card)} aria-label={`${c.action}: ${title}`}>{c.action}<span aria-hidden="true">{locale==='ar'?'←':'→'}</span></button>
   </article>;
  })}</div>
 </section>;
}
