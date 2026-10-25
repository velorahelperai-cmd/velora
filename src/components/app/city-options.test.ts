import { describe, expect, it } from "vitest";
import { cityKnownInCountry, findCities } from "./city-options";

describe("city-options", () => {
  it("lists Oman cities and filters by typed prefix", () => {
    const all = findCities("OM", "", true);
    expect(all.some((city) => city.en === "Muscat")).toBe(true);
    expect(findCities("OM", "مس", true).some((city) => city.ar === "مسقط")).toBe(true);
    expect(findCities("OM", "sal", false).some((city) => city.en === "Salalah")).toBe(true);
  });

  it("keeps city recognition across Arabic and English labels", () => {
    expect(cityKnownInCountry("OM", "مسقط")).toBe(true);
    expect(cityKnownInCountry("OM", "Muscat")).toBe(true);
    expect(cityKnownInCountry("AE", "مسقط")).toBe(false);
  });
});
