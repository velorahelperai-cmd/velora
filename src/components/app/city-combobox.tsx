"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { findCities, type CityOption } from "./city-options";
import styles from "./country-combobox.module.css";

export function CityCombobox({
  id,
  value,
  country,
  ar,
  disabled = false,
  required = true,
  onChange,
}: {
  id: string;
  value: string;
  country: string;
  ar: boolean;
  disabled?: boolean;
  required?: boolean;
  onChange: (city: string) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement | null>(null);
  const hasCountry = Boolean(country.trim());
  const locked = disabled || !hasCountry;
  const open = query !== null && !locked;
  const results = findCities(country, query ?? "", ar);
  const listId = `${id}-options`;

  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  function close() {
    setQuery(null);
    setActive(-1);
  }

  function show() {
    if (locked) return;
    setQuery(value);
    setActive(findCities(country, value, ar).findIndex((city) => cityLabel(city, ar) === value.trim() || city.en === value.trim() || city.ar === value.trim()));
  }

  function choose(city: CityOption) {
    if (locked) return;
    onChange(cityLabel(city, ar));
    close();
    input.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        setActive(0);
        return;
      }
      setActive((index) => Math.max(0, Math.min(results.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (results[active]) choose(results[active]);
      else close();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") close();
  }

  return (
    <div
      className={styles.country}
      data-setup-city-combobox="true"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className={styles.control}>
        <input
          ref={input}
          id={id}
          data-setup-entry-control=""
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && results[active] ? `${id}-option-${results[active].id}` : undefined}
          aria-required={required || undefined}
          aria-label={ar ? "المدينة" : "City"}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          required={required}
          disabled={locked}
          value={open ? (query ?? "") : value}
          placeholder={
            !hasCountry
              ? ar
                ? "اختر الدولة أولًا"
                : "Choose a country first"
              : ar
                ? "اختر المدينة أو ابحث عنها"
                : "Choose or search for a city"
          }
          onFocus={show}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setActive(0);
            onChange(next);
          }}
          onKeyDown={keyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={locked}
          aria-label={ar ? "فتح قائمة المدن" : "Open city list"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              show();
              input.current?.focus();
            }
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className={styles.popup}>
          <div id={listId} role="listbox" aria-label={ar ? "المدن" : "Cities"} className={styles.options}>
            {results.map((city, index) => (
              <button
                key={city.id}
                type="button"
                role="option"
                tabIndex={-1}
                id={`${id}-option-${city.id}`}
                aria-selected={cityLabel(city, ar) === value.trim()}
                data-active={index === active || undefined}
                data-city={city.id}
                ref={index === active ? activeOption : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(city)}
              >
                <span className={styles.primary}>
                  <span className={styles.optionName} title={cityLabel(city, ar)}>
                    {cityLabel(city, ar)}
                  </span>
                </span>
                <span className={styles.secondary} lang={ar ? "en" : "ar"} dir={ar ? "ltr" : "rtl"}>
                  {ar ? city.en : city.ar}
                </span>
              </button>
            ))}
          </div>
          {!results.length ? (
            <p role="status" className={styles.empty}>
              {ar
                ? "لا توجد مدينة بهذا الاسم في القائمة. يمكنك كتابة اسم المدينة مباشرة."
                : "No matching city in the list. You can type the city name directly."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function cityLabel(city: CityOption, ar: boolean) {
  return ar ? city.ar : city.en;
}
