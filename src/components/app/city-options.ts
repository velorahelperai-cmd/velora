export type CityOption = { id: string; country: string; ar: string; en: string; aliases?: string[] };

/** Curated cities by ISO country for setup city combobox (GCC + common MENA first). */
export const cities: readonly CityOption[] = [
  // Oman
  { id: "OM-muscat", country: "OM", ar: "مسقط", en: "Muscat", aliases: ["مسقط العاصمة"] },
  { id: "OM-salalah", country: "OM", ar: "صلالة", en: "Salalah" },
  { id: "OM-sohar", country: "OM", ar: "صحار", en: "Sohar" },
  { id: "OM-nizwa", country: "OM", ar: "نزوى", en: "Nizwa" },
  { id: "OM-sur", country: "OM", ar: "صور", en: "Sur" },
  { id: "OM-ibri", country: "OM", ar: "عبري", en: "Ibri" },
  { id: "OM-barka", country: "OM", ar: "بركاء", en: "Barka" },
  { id: "OM-rustaq", country: "OM", ar: "الرستاق", en: "Rustaq" },
  { id: "OM-seeb", country: "OM", ar: "السيب", en: "Seeb", aliases: ["As Seeb"] },
  { id: "OM-buraimi", country: "OM", ar: "البريمي", en: "Al Buraimi" },
  { id: "OM-khasab", country: "OM", ar: "خصب", en: "Khasab" },
  { id: "OM-ibra", country: "OM", ar: "إبراء", en: "Ibra" },
  // UAE
  { id: "AE-dubai", country: "AE", ar: "دبي", en: "Dubai" },
  { id: "AE-abu-dhabi", country: "AE", ar: "أبوظبي", en: "Abu Dhabi", aliases: ["Abu Dhabi", "ابو ظبي"] },
  { id: "AE-sharjah", country: "AE", ar: "الشارقة", en: "Sharjah" },
  { id: "AE-ajman", country: "AE", ar: "عجمان", en: "Ajman" },
  { id: "AE-ras-al-khaimah", country: "AE", ar: "رأس الخيمة", en: "Ras Al Khaimah" },
  { id: "AE-fujairah", country: "AE", ar: "الفجيرة", en: "Fujairah" },
  { id: "AE-umm-al-quwain", country: "AE", ar: "أم القيوين", en: "Umm Al Quwain" },
  { id: "AE-al-ain", country: "AE", ar: "العين", en: "Al Ain" },
  // Saudi Arabia
  { id: "SA-riyadh", country: "SA", ar: "الرياض", en: "Riyadh" },
  { id: "SA-jeddah", country: "SA", ar: "جدة", en: "Jeddah" },
  { id: "SA-mecca", country: "SA", ar: "مكة المكرمة", en: "Mecca", aliases: ["مكة", "Makkah"] },
  { id: "SA-medina", country: "SA", ar: "المدينة المنورة", en: "Medina", aliases: ["المدينة", "Madinah"] },
  { id: "SA-dammam", country: "SA", ar: "الدمام", en: "Dammam" },
  { id: "SA-khobar", country: "SA", ar: "الخبر", en: "Khobar" },
  { id: "SA-dhahran", country: "SA", ar: "الظهران", en: "Dhahran" },
  { id: "SA-taif", country: "SA", ar: "الطائف", en: "Taif" },
  { id: "SA-tabuk", country: "SA", ar: "تبوك", en: "Tabuk" },
  { id: "SA-abha", country: "SA", ar: "أبها", en: "Abha" },
  { id: "SA-jubail", country: "SA", ar: "الجبيل", en: "Jubail" },
  { id: "SA-yanbu", country: "SA", ar: "ينبع", en: "Yanbu" },
  // Kuwait
  { id: "KW-kuwait-city", country: "KW", ar: "مدينة الكويت", en: "Kuwait City" },
  { id: "KW-hawalli", country: "KW", ar: "حولي", en: "Hawalli" },
  { id: "KW-salmiya", country: "KW", ar: "السالمية", en: "Salmiya" },
  { id: "KW-farwaniya", country: "KW", ar: "الفروانية", en: "Farwaniya" },
  { id: "KW-jahra", country: "KW", ar: "الجهراء", en: "Jahra" },
  { id: "KW-ahmadi", country: "KW", ar: "الأحمدي", en: "Ahmadi" },
  // Bahrain
  { id: "BH-manama", country: "BH", ar: "المنامة", en: "Manama" },
  { id: "BH-muharraq", country: "BH", ar: "المحرق", en: "Muharraq" },
  { id: "BH-riffa", country: "BH", ar: "الرفاع", en: "Riffa" },
  { id: "BH-isa-town", country: "BH", ar: "مدينة عيسى", en: "Isa Town" },
  // Qatar
  { id: "QA-doha", country: "QA", ar: "الدوحة", en: "Doha" },
  { id: "QA-al-rayyan", country: "QA", ar: "الريان", en: "Al Rayyan" },
  { id: "QA-al-wakrah", country: "QA", ar: "الوكرة", en: "Al Wakrah" },
  { id: "QA-lusail", country: "QA", ar: "لوسيل", en: "Lusail" },
  // Egypt
  { id: "EG-cairo", country: "EG", ar: "القاهرة", en: "Cairo" },
  { id: "EG-giza", country: "EG", ar: "الجيزة", en: "Giza" },
  { id: "EG-alexandria", country: "EG", ar: "الإسكندرية", en: "Alexandria" },
  { id: "EG-sharm", country: "EG", ar: "شرم الشيخ", en: "Sharm El Sheikh" },
  { id: "EG-hurghada", country: "EG", ar: "الغردقة", en: "Hurghada" },
  { id: "EG-mansoura", country: "EG", ar: "المنصورة", en: "Mansoura" },
  { id: "EG-tanta", country: "EG", ar: "طنطا", en: "Tanta" },
  { id: "EG-aswan", country: "EG", ar: "أسوان", en: "Aswan" },
  { id: "EG-luxor", country: "EG", ar: "الأقصر", en: "Luxor" },
  // Jordan
  { id: "JO-amman", country: "JO", ar: "عمّان", en: "Amman", aliases: ["عمان"] },
  { id: "JO-zarqa", country: "JO", ar: "الزرقاء", en: "Zarqa" },
  { id: "JO-irbid", country: "JO", ar: "إربد", en: "Irbid" },
  { id: "JO-aqaba", country: "JO", ar: "العقبة", en: "Aqaba" },
  // Iraq
  { id: "IQ-baghdad", country: "IQ", ar: "بغداد", en: "Baghdad" },
  { id: "IQ-basra", country: "IQ", ar: "البصرة", en: "Basra" },
  { id: "IQ-erbil", country: "IQ", ar: "أربيل", en: "Erbil" },
  { id: "IQ-mosul", country: "IQ", ar: "الموصل", en: "Mosul" },
  { id: "IQ-najaf", country: "IQ", ar: "النجف", en: "Najaf" },
  // Yemen
  { id: "YE-sanaa", country: "YE", ar: "صنعاء", en: "Sanaa", aliases: ["Sana'a"] },
  { id: "YE-aden", country: "YE", ar: "عدن", en: "Aden" },
  { id: "YE-taiz", country: "YE", ar: "تعز", en: "Taiz" },
  // Morocco
  { id: "MA-casablanca", country: "MA", ar: "الدار البيضاء", en: "Casablanca" },
  { id: "MA-rabat", country: "MA", ar: "الرباط", en: "Rabat" },
  { id: "MA-marrakesh", country: "MA", ar: "مراكش", en: "Marrakesh" },
  { id: "MA-fes", country: "MA", ar: "فاس", en: "Fes" },
  { id: "MA-tangier", country: "MA", ar: "طنجة", en: "Tangier" },
  // Algeria
  { id: "DZ-algiers", country: "DZ", ar: "الجزائر", en: "Algiers" },
  { id: "DZ-oran", country: "DZ", ar: "وهران", en: "Oran" },
  { id: "DZ-constantine", country: "DZ", ar: "قسنطينة", en: "Constantine" },
  // Tunisia
  { id: "TN-tunis", country: "TN", ar: "تونس", en: "Tunis" },
  { id: "TN-sfax", country: "TN", ar: "صفاقس", en: "Sfax" },
  { id: "TN-sousse", country: "TN", ar: "سوسة", en: "Sousse" },
  // Lebanon
  { id: "LB-beirut", country: "LB", ar: "بيروت", en: "Beirut" },
  { id: "LB-tripoli", country: "LB", ar: "طرابلس", en: "Tripoli" },
  { id: "LB-sidon", country: "LB", ar: "صيدا", en: "Sidon" },
  // Syria
  { id: "SY-damascus", country: "SY", ar: "دمشق", en: "Damascus" },
  { id: "SY-aleppo", country: "SY", ar: "حلب", en: "Aleppo" },
  { id: "SY-homs", country: "SY", ar: "حمص", en: "Homs" },
  // Palestine
  { id: "PS-gaza", country: "PS", ar: "غزة", en: "Gaza" },
  { id: "PS-ramallah", country: "PS", ar: "رام الله", en: "Ramallah" },
  { id: "PS-nablus", country: "PS", ar: "نابلس", en: "Nablus" },
  { id: "PS-hebron", country: "PS", ar: "الخليل", en: "Hebron" },
  // Sudan
  { id: "SD-khartoum", country: "SD", ar: "الخرطوم", en: "Khartoum" },
  { id: "SD-omdurman", country: "SD", ar: "أم درمان", en: "Omdurman" },
  // Turkey
  { id: "TR-istanbul", country: "TR", ar: "إسطنبول", en: "Istanbul" },
  { id: "TR-ankara", country: "TR", ar: "أنقرة", en: "Ankara" },
  { id: "TR-izmir", country: "TR", ar: "إزمير", en: "Izmir" },
  { id: "TR-antalya", country: "TR", ar: "أنطاليا", en: "Antalya" },
  // UK
  { id: "GB-london", country: "GB", ar: "لندن", en: "London" },
  { id: "GB-manchester", country: "GB", ar: "مانشستر", en: "Manchester" },
  { id: "GB-birmingham", country: "GB", ar: "برمنغهام", en: "Birmingham" },
  // USA
  { id: "US-new-york", country: "US", ar: "نيويورك", en: "New York" },
  { id: "US-los-angeles", country: "US", ar: "لوس أنجلوس", en: "Los Angeles" },
  { id: "US-chicago", country: "US", ar: "شيكاغو", en: "Chicago" },
  { id: "US-houston", country: "US", ar: "هيوستن", en: "Houston" },
  // India
  { id: "IN-mumbai", country: "IN", ar: "مومباي", en: "Mumbai" },
  { id: "IN-delhi", country: "IN", ar: "نيودلهي", en: "New Delhi", aliases: ["Delhi"] },
  { id: "IN-bangalore", country: "IN", ar: "بنغالور", en: "Bengaluru", aliases: ["Bangalore"] },
  // Pakistan
  { id: "PK-karachi", country: "PK", ar: "كراتشي", en: "Karachi" },
  { id: "PK-lahore", country: "PK", ar: "لاهور", en: "Lahore" },
  { id: "PK-islamabad", country: "PK", ar: "إسلام آباد", en: "Islamabad" },
];

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[ى]/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const byCountry = new Map<string, CityOption[]>();
for (const city of cities) {
  const code = city.country.toUpperCase();
  const list = byCountry.get(code) ?? [];
  list.push(city);
  byCountry.set(code, list);
}

export function citiesForCountry(country: string): readonly CityOption[] {
  return byCountry.get(country.trim().toUpperCase()) ?? [];
}

export function findCities(country: string, query: string, ar: boolean): CityOption[] {
  const list = [...citiesForCountry(country)].sort((a, b) =>
    (ar ? a.ar : a.en).localeCompare(ar ? b.ar : b.en, ar ? "ar" : "en"),
  );
  const text = normalize(query);
  if (!text) return list;
  return list
    .filter((city) => normalize([city.ar, city.en, ...(city.aliases ?? [])].join(" ")).includes(text))
    .sort((a, b) => {
      const exact = (city: CityOption) => [city.ar, city.en, ...(city.aliases ?? [])].some((v) => normalize(v) === text);
      return Number(exact(b)) - Number(exact(a));
    });
}

export function cityKnownInCountry(country: string, value: string): boolean {
  const text = normalize(value);
  if (!text) return false;
  return citiesForCountry(country).some((city) =>
    [city.ar, city.en, ...(city.aliases ?? [])].some((v) => normalize(v) === text),
  );
}
