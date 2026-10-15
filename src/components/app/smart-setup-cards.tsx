'use client';
import type {SmartSetupCard,SetupCardId,SetupStatus} from '@/lib/tenancy/smart-onboarding';
import styles from './smart-setup-accordion.module.css';
import {useEffect,useId,useRef,type ReactNode,type KeyboardEvent} from 'react';
import {SetupEmployee} from './setup-employee';

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

type Props={locale:'ar'|'en';cards:SmartSetupCard[];percent:number;completedRequired:number;totalRequired:number;onOpen:(card:SmartSetupCard)=>void;activeCardId?:SetupCardId|null;onClose?:()=>void;children?:ReactNode;enabled?:boolean;progressKind?:'readiness'|'page'};
/** Presentation only: ordering, readiness, required flags and navigation guards remain with the caller. */
export function SmartSetupCards({locale,cards,percent,completedRequired,totalRequired,onOpen,activeCardId=null,onClose,children,enabled=true,progressKind='readiness'}:Props){
 const c=copy[locale],ar=locale==='ar',id=useId(),buttons=useRef(new Map<SetupCardId,HTMLButtonElement>()),previous=useRef(activeCardId);
 useEffect(()=>{const last=previous.current;previous.current=activeCardId;if(last&&!activeCardId&&document.activeElement===document.body)buttons.current.get(last)?.focus({preventScroll:true});},[activeCardId]);
 if(!enabled)return <>{children}</>;
 const progressLabel=progressKind==='page'?(ar?'اكتمال بيانات الصفحة':'Page data completion'):c.progress;
 const active=cards.find(card=>card.id===activeCardId);
 const guide=active?c.cards[active.id][1]:(ar?'اختَر خطوة للبدء، وأنا أوضح لك ما تحتاجه فيها.':'Choose a step and I will explain what you need.');
 function navigate(event:KeyboardEvent<HTMLButtonElement>,index:number){let next:number|null=null;
  if(event.key==='ArrowDown')next=(index+1)%cards.length;if(event.key==='ArrowUp')next=(index+cards.length-1)%cards.length;if(event.key==='Home')next=0;if(event.key==='End')next=cards.length-1;
  if(next!==null){event.preventDefault();buttons.current.get(cards[next].id)?.focus();}
 }
 return <section className={styles.accordion} dir={ar?'rtl':'ltr'} aria-labelledby={`${id}-title`}>
  <header className={styles.intro}><div><h2 id={`${id}-title`}>{ar?'جهّز نشاطك خطوة بخطوة':'Set up your business step by step'}</h2><p>{ar?'افتح أي قسم متاح وأكمل إعداداته هنا.':'Open any available section and complete its settings here.'}</p></div><div className={styles.progressSummary}><strong>{percent}%</strong><span>{progressLabel} · {completedRequired}/{totalRequired}</span></div></header>
  <div className={styles.progress} role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{width:`${percent}%`}}/></div>
  {progressKind==='page'?<p className={styles.completionNote}>{ar?'هذه النسبة لبيانات النشاط والفروع فقط، ولا تعني جاهزية التشغيل أو تفعيل الخدمة.':'This progress covers business and branch data only; it does not prove operational readiness or activate service.'}</p>:null}
  <div className={styles.layout}>
   <aside className={styles.guide} data-setup-guide="" aria-label={ar?'إرشادات موظفتك الرقمية':'Your digital employee guide'}>
    <div className={styles.portrait}><SetupEmployee ar={ar}/></div>
    <div className={styles.bubbles}><p className={styles.bubble} key={activeCardId??'welcome'}>{guide}</p><p className={styles.smallBubble}>{ar?'تقدر ترجع لأي خطوة متاحة.':'You can return to any available step.'}</p></div>
   </aside>
   <div className={styles.steps}>{cards.map((card,index)=>{
    const [title,body]=c.cards[card.id],open=card.id===activeCardId;
    const reason=card.missing==='branch_pending'?(ar?'الفروع الإضافية المحفوظة تحتاج تجهيزاً قبل التشغيل.':'Saved secondary branches await their operational setup.'):card.missing==='review_configuration'?(ar?'مراجعة الجاهزية تنتظر تهيئة السياسة المعتمدة.':'Readiness review awaits approved configuration.'):c.reasons[card.missing as keyof typeof c.reasons];
    return <article className={styles.step} key={card.id} data-setup-section={card.id} data-open={open?'true':undefined}>
     <h3 className={styles.heading}><button type="button" className={styles.stepHeader} id={`${id}-${card.id}-toggle`} ref={node=>{if(node)buttons.current.set(card.id,node);else buttons.current.delete(card.id);}}
      aria-expanded={open} aria-controls={`${id}-${card.id}-panel`} aria-label={`${title} — ${c.status[card.status as SetupStatus]}`} onKeyDown={event=>navigate(event,index)} onClick={()=>open?onClose?.():onOpen(card)}>
      <span className={styles.number} aria-hidden="true">{index+1}</span><span className={styles.label}><span className={styles.title}>{title}</span><span className={styles.requirement}>{card.required?c.required:c.optional}</span></span>
      <span className={styles.status} data-status={card.status}>{c.status[card.status as SetupStatus]}</span><svg className={styles.chevron} aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
     </button></h3>
     {!open&&card.missing&&reason?<p className={styles.remaining}>{reason}</p>:null}
     <div id={`${id}-${card.id}-panel`} role="region" aria-labelledby={`${id}-${card.id}-toggle`} hidden={!open}>
      {open?<div className={styles.editor}><p className={styles.description}>{body}</p>{children}</div>:null}
     </div>
    </article>;
   })}</div>
  </div>
 </section>;
}
