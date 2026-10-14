import {businessSetupPreset} from '@/lib/tenancy/setup-presets';
export function BusinessSetupGuidance({type,ar}:{type:string;ar:boolean}){
 const preset=businessSetupPreset(type),locale=ar?'ar':'en';
 return <aside className="rounded-xl border border-[color:var(--color-border-soft)] p-4">
  <h3>{preset.label[locale]}</h3><ul className="list-disc ps-5">{preset.fields.map(field=><li key={field.en}>{field[locale]}</li>)}</ul>
  <p className="mt-2 text-sm">{ar?'أضف معلومات نشاطك الفعلية وعدّلها في مصادر المعرفة أدناه. تغيير النوع لا يحذف المعلومات السابقة. كل مصدر يحتاج اعتمادك الصريح قبل استخدامه في الرد.':'Add and edit your actual business information in the knowledge sources below. Changing business type preserves existing information. Each source needs your explicit approval before use in replies.'}</p>
 </aside>;
}
