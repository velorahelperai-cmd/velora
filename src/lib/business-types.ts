type Seed=readonly [id:string,ar:string,en:string,aliases?:string];
type Group={id:string;ar:string;en:string;options:readonly Seed[]};
export type BusinessTypeOption={id:string;ar:string;en:string;group:string;aliases:string};
/** Additive labels only. Existing stored IDs are never migrated or inferred from a business name. */
export const businessTypeGroups:readonly Group[]=[
 {id:'food',ar:'المطاعم والأغذية',en:'Food and drink',options:[
  ['restaurant','مطعم','Restaurant','برجر مشويات وجبات burger grill'],['cafe','مقهى وكافيه','Cafe','قهوة كوفي coffee'],['bakery','مخبز','Bakery'],['sweets','حلويات وشوكولاتة','Sweets and chocolate'],['catering','تموين وضيافة مناسبات','Catering'],['cloud_kitchen','مطبخ سحابي','Cloud kitchen'],['food_truck','عربة طعام','Food truck'],['juice_shop','عصائر ومشروبات','Juice shop'],['ice_cream','آيس كريم','Ice cream shop'],['coffee_roaster','محمصة قهوة','Coffee roaster'],['meal_prep','وجبات صحية واشتراكات','Meal preparation'],['seafood_shop','أسماك ومأكولات بحرية','Seafood shop'],
 ]},
 {id:'retail',ar:'المتاجر والتجارة الإلكترونية',en:'Retail and online stores',options:[
  ['retail','متجر تجزئة عام','Retail store'],['e_commerce','متجر إلكتروني','Online store','تجارة الكترونية ecommerce e commerce'],['fashion','ملابس وأزياء','Clothing and fashion'],['abaya','عبايات وأزياء محتشمة','Abayas and modest fashion'],['footwear','أحذية وحقائب','Shoes and bags'],['jewelry','مجوهرات وذهب','Jewelry and gold'],['watches','ساعات وإكسسوارات','Watches and accessories'],['perfumes','عطور وبخور','Perfume and incense'],['cosmetics_shop','متجر مستحضرات تجميل','Cosmetics store'],['electronics','إلكترونيات وأجهزة','Electronics store'],['mobile_shop','هواتف وملحقاتها','Mobile phone shop'],['furniture','أثاث ومفروشات','Furniture store'],['homeware','أدوات ومنتجات منزلية','Homeware store'],['gifts_flowers','هدايا وزهور','Gifts and flowers'],['books_stationery','كتب وقرطاسية','Books and stationery'],['toys','ألعاب ومنتجات أطفال','Toys and children’s products'],['grocery','بقالة وسوبرماركت','Grocery and supermarket'],['sports_store','أدوات وملابس رياضية','Sporting goods store'],['pet_store','متجر مستلزمات حيوانات','Pet supplies store'],['hardware','أدوات ومواد بناء','Hardware and building supplies'],
 ]},
 {id:'education',ar:'التعليم والتدريب',en:'Education and training',options:[
  ['school','مدرسة','School'],['nursery','حضانة وروضة','Nursery and kindergarten'],['training_center','مركز تدريب','Training center'],['language_center','مركز لغات','Language center'],['tutoring','دروس خصوصية','Tutoring'],['online_courses','دورات وتعليم إلكتروني','Online courses'],['driving_school','مدرسة تعليم قيادة','Driving school'],['music_art_school','تعليم موسيقى وفنون','Music and art classes'],
 ]},
 {id:'health',ar:'الصحة والحجوزات الطبية',en:'Healthcare enquiries and bookings',options:[
  ['clinic','عيادة ومركز صحي','Clinic and health center','عياده عيادات طبي medical'],['dental_clinic','عيادة أسنان','Dental clinic'],['physiotherapy','مركز علاج طبيعي','Physiotherapy center'],['medical_lab','مختبر تحاليل','Medical laboratory'],['optical','بصريات ونظارات','Optical store'],['pharmacy','صيدلية','Pharmacy'],['veterinary','عيادة بيطرية','Veterinary clinic'],['hospital','مستشفى','Hospital'],
 ]},
 {id:'property',ar:'العقارات والسكن',en:'Property and housing',options:[
  ['real_estate','مكتب عقارات','Real estate agency'],['property_management','إدارة أملاك','Property management'],['property_developer','تطوير عقاري','Property developer'],['coworking','مساحات عمل ومكاتب','Coworking and offices'],['property_maintenance','صيانة مبانٍ وعقارات','Property maintenance'],
 ]},
 {id:'travel',ar:'السياحة والضيافة',en:'Travel and hospitality',options:[
  ['hotel','فندق','Hotel'],['furnished_apartments','شقق فندقية','Serviced apartments'],['resort','منتجع وشاليهات','Resort and chalets'],['travel_agency','وكالة سفر وسياحة','Travel agency'],['tour_operator','رحلات وتجارب سياحية','Tours and experiences'],['holiday_rentals','إيجار منازل واستراحات','Holiday rentals'],['transport_booking','حجوزات نقل سياحي','Tourist transport bookings'],
 ]},
 {id:'beauty',ar:'التجميل والعناية',en:'Beauty and personal care',options:[
  ['beauty_salon','صالون تجميل','Beauty salon'],['barber','حلاقة رجالية','Barber shop'],['spa','سبا وعناية بالجسم','Spa and body care'],['nail_salon','عناية بالأظافر','Nail salon'],['makeup_artist','خبيرة مكياج','Makeup artist'],['bridal_beauty','تجهيز وعناية عرائس','Bridal beauty'],
 ]},
 {id:'automotive',ar:'السيارات والمركبات',en:'Automotive',options:[
  ['car_dealer','معرض سيارات','Car dealership'],['car_rental','تأجير سيارات','Car rental'],['auto_repair','ورشة صيانة سيارات','Car repair workshop','تصليح سيارات ميكانيكا auto repair mechanic'],['car_wash','غسيل وتلميع سيارات','Car wash and detailing'],['auto_parts','قطع غيار سيارات','Auto parts'],['tire_shop','إطارات وبطاريات','Tires and batteries'],['vehicle_recovery','سطحة ومساعدة على الطريق','Vehicle recovery'],['motorcycle_service','دراجات نارية وصيانتها','Motorcycles and service'],
 ]},
 {id:'home',ar:'الخدمات المنزلية',en:'Home services',options:[
  ['home_cleaning','تنظيف منازل ومكاتب','Home and office cleaning'],['laundry','مغسلة ملابس','Laundry'],['air_conditioning','تكييف وتبريد','Air conditioning service'],['plumbing','سباكة','Plumbing'],['electrical','كهرباء وتمديدات','Electrical service'],['pest_control','مكافحة حشرات','Pest control'],['moving','نقل أثاث','Moving service'],['gardening','حدائق وتنسيق خارجي','Gardening and landscaping'],['appliance_repair','صيانة أجهزة منزلية','Appliance repair'],['carpentry','نجارة وأعمال خشبية','Carpentry'],
 ]},
 {id:'professional',ar:'الخدمات المهنية والأعمال',en:'Professional and business services',options:[
  ['services','خدمات عامة','General services'],['marketing_agency','تسويق وإعلانات','Marketing agency'],['design_studio','تصميم وهوية بصرية','Design studio'],['software_company','برمجيات وحلول تقنية','Software company'],['it_support','دعم وصيانة تقنية','IT support'],['accounting','مكتب محاسبة','Accounting office'],['legal_office','مكتب محاماة','Legal office'],['insurance_office','مكتب خدمات تأمين','Insurance office'],['business_consulting','استشارات أعمال','Business consulting'],['translation','ترجمة وتدقيق','Translation and proofreading'],['printing','طباعة وتغليف','Printing and packaging'],['recruitment','خدمات توظيف','Recruitment services'],
 ]},
 {id:'events',ar:'الفعاليات والخدمات الإبداعية',en:'Events and creative services',options:[
  ['event_planning','تنظيم فعاليات','Event planning'],['wedding_planning','تنظيم حفلات زفاف','Wedding planning'],['event_venue','قاعة مناسبات','Event venue'],['photography','تصوير فوتوغرافي','Photography'],['video_production','تصوير وإنتاج فيديو','Video production'],['event_rental','تأجير معدات مناسبات','Event equipment rental'],['entertainment','ترفيه وأنشطة عائلية','Entertainment and family activities'],
 ]},
 {id:'fitness',ar:'الرياضة والأنشطة',en:'Sports and activities',options:[
  ['gym','نادي رياضي','Gym'],['personal_training','تدريب شخصي','Personal training'],['sports_academy','أكاديمية رياضية','Sports academy'],['swimming','تعليم سباحة','Swimming lessons'],['yoga_pilates','يوغا وبيلاتس','Yoga and Pilates'],['sports_facility','ملاعب ومرافق رياضية','Sports facilities'],
 ]},
 {id:'logistics',ar:'النقل والخدمات اللوجستية',en:'Transport and logistics',options:[
  ['courier','توصيل وشحن طرود','Courier and parcel delivery'],['freight','شحن ونقل بضائع','Freight and cargo'],['warehousing','تخزين ومستودعات','Warehousing'],['passenger_transport','نقل ركاب','Passenger transport'],['equipment_rental','تأجير معدات','Equipment rental'],
 ]},
 {id:'other',ar:'أنشطة أخرى',en:'Other businesses',options:[['other','نشاط آخر','Other business']]},
];
export const businessTypes:readonly BusinessTypeOption[]=businessTypeGroups.flatMap(group=>group.options.map(([id,ar,en,aliases=''])=>({id,ar,en,aliases,group:group.id})));
export const normalizeBusinessTypeSearch=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/ـ/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const byId=new Map(businessTypes.map(item=>[item.id,item]));
const search=new Map(businessTypes.map(item=>{const group=businessTypeGroups.find(g=>g.id===item.group)!;return [item.id,normalizeBusinessTypeSearch([item.id,item.ar,item.en,item.aliases,group.ar,group.en].join(' '))];}));
export function findBusinessTypes(query:string):BusinessTypeOption[]{
 const text=normalizeBusinessTypeSearch(query),tokens=text.split(' ').filter(Boolean);
 const score=(item:BusinessTypeOption)=>[item.id,item.ar,item.en].some(label=>normalizeBusinessTypeSearch(label)===text)?0:tokens.every(token=>normalizeBusinessTypeSearch([item.id,item.ar,item.en,item.aliases].join(' ')).includes(token))?1:2;
 return businessTypes.filter(item=>tokens.every(token=>search.get(item.id)!.includes(token))).sort((a,b)=>score(a)-score(b));
}
/** store is a legacy spelling of retail; keep the stored value until the user deliberately chooses. */
export function businessTypeLabel(value:string,ar:boolean){return byId.get(value==='store'?'retail':value)?.[ar?'ar':'en']??value;}
export function customBusinessType(query:string):string|null{const value=query.trim();if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))return null;const normalized=normalizeBusinessTypeSearch(value);if(businessTypes.some(item=>[item.id,item.ar,item.en].some(label=>normalizeBusinessTypeSearch(label)===normalized)))return null;return value;}
