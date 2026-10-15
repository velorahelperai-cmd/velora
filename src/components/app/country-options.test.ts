import { expect, it } from 'vitest';
import { countries, countryLabel, findCountries } from './country-options';
it('covers the pinned global dataset without missing labels or duplicate codes', () => {
  expect(countries).toHaveLength(250);
  expect(new Set(countries.map(country => country.code)).size).toBe(250);
  expect(countries.every(country => /^[A-Z]{2}$/.test(country.code) && country.ar && country.en)).toBe(true);
});
it('searches either language and Arabic spelling variants independently of display language', () => {
  expect(findCountries('عُمان', false).map(country => country.code)).toContain('OM');
  expect(findCountries('Egypt', true).map(country => country.code)).toContain('EG');
  expect(findCountries('الامارات', true).map(country => country.code)).toContain('AE');
  expect(findCountries('USA', true).map(country => country.code)).toContain('US');
  expect(findCountries('not-a-country-query', true)).toEqual([]);
});
it('displays a saved country by name and preserves unknown legacy values without inventing a location', () => {
  expect(countryLabel('OM', false)).toBe('Oman');
  expect(countryLabel('OM', true)).not.toBe('OM');
  expect(countryLabel('Legacy country', true)).toBe('Legacy country');
  expect(countryLabel('', true)).toBe('');
});
