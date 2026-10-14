/** Prompts only: a template never supplies facts or removes existing knowledge. */
export type SetupPreset = {label:{ar:string;en:string};fields:readonly {ar:string;en:string}[]};
const presets:Record<string,SetupPreset>={
 restaurant:{label:{ar:'تجهيز مطعم',en:'Restaurant setup'},fields:[{ar:'القائمة والأسعار الفعلية',en:'Actual menu and prices'},{ar:'خيارات الطلب والتوصيل',en:'Ordering and delivery options'},{ar:'الحساسية والحجوزات حسب السياسة المعتمدة',en:'Approved allergy and reservation policies'}]},
 store:{label:{ar:'تجهيز متجر',en:'Store setup'},fields:[{ar:'المنتجات والمتغيرات والأسعار',en:'Products, variants and prices'},{ar:'التوفر وسياسة الشحن',en:'Availability and shipping policy'},{ar:'الاسترجاع والاستبدال المعتمدان',en:'Approved returns and exchanges'}]},
 clinic:{label:{ar:'تجهيز عيادة',en:'Clinic setup'},fields:[{ar:'الخدمات والمواعيد وطريقة الحجز',en:'Services, appointments and booking'},{ar:'معلومات الفريق المؤكدة',en:'Verified team information'},{ar:'حدود الرد والإحالة للموظف',en:'Reply boundaries and staff handoff'}]},
 services:{label:{ar:'تجهيز شركة خدمات',en:'Services company setup'},fields:[{ar:'نطاق الخدمات والأسعار أو عرض السعر',en:'Service scope, prices or quotation'},{ar:'المناطق وأوقات التنفيذ',en:'Coverage and delivery times'},{ar:'خطوات الطلب والسياسات المعتمدة',en:'Ordering steps and approved policies'}]},
 other:{label:{ar:'تجهيز نشاط آخر',en:'Other business setup'},fields:[{ar:'المنتجات أو الخدمات المؤكدة',en:'Verified products or services'},{ar:'الأسعار وطريقة التواصل',en:'Prices and contact method'},{ar:'السياسات والأسئلة الشائعة الفعلية',en:'Actual policies and frequently asked questions'}]},
};
export function businessSetupPreset(type:string):SetupPreset{return presets[type==='retail'?'store':type]??presets.other;}
