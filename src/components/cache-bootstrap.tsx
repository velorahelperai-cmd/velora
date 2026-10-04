"use client";

import { useEffect } from "react";

const CACHE_NAME = "velora-static-v1";

function isAppWorker(registration: ServiceWorkerRegistration) {
  const script =
    registration.active?.scriptURL ??
    registration.waiting?.scriptURL ??
    registration.installing?.scriptURL ??
    "";
  return script.includes("/sw.js");
}

/** Drops this app's static worker and its named cache. Does not touch cookies or other cache names. */
async function retireDevWorker() {
  if (!("serviceWorker" in navigator)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const ours = registrations.filter(isAppWorker);
  await Promise.all(ours.map((registration) => registration.unregister()));
  if ("caches" in window) await caches.delete(CACHE_NAME);
  return ours.length > 0;
}

/** Production keeps the static worker. Development removes it so Next.js updates load normally. */
export function CacheBootstrap() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "development") {
      const retire = () => {
        void retireDevWorker().then((removed) => {
          if (removed && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      };
      if (document.readyState === "complete") retire();
      else window.addEventListener("load", retire, { once: true });
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignore registration failures (private mode, etc.) */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
