import data from './country-options.json';

export type CountryOption = { code: string; alpha3: string; ar: string; en: string; aliases: string[] };
/** Pinned MIT dataset: 249 ISO 3166-1 entries and the source's XK extension. */
export const countries: readonly CountryOption[] = data.countries;
const byCode = new Map(countries.map(country => [country.code, country]));
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/[ى]/g, 'ي').replace(/ة/g, 'ه').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const searchable = new Map(countries.map(country => [country.code, normalize([country.code, country.alpha3, country.ar, country.en, ...country.aliases].join(' '))]));
const ordered = {
  ar: [...countries].sort((a, b) => a.ar.localeCompare(b.ar, 'ar')),
  en: [...countries].sort((a, b) => a.en.localeCompare(b.en, 'en')),
};
export function findCountries(query: string, ar: boolean): CountryOption[] {
  const text = normalize(query);
  const list = ordered[ar ? 'ar' : 'en'];
  if (!text) return list;
  return list.filter(country => searchable.get(country.code)!.includes(text)).sort((a, b) => {
    const exact = (country: CountryOption) => [country.code, country.alpha3, country.ar, country.en].some(value => normalize(value) === text);
    return Number(exact(b)) - Number(exact(a));
  });
}
export function countryLabel(value: string, ar: boolean) {
  const country = byCode.get(value.trim().toUpperCase());
  return country ? country[ar ? 'ar' : 'en'] : value;
}
