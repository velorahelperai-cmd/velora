"use client";
import { useEffect } from "react";

/** Existing workers migrate without reloading forms. New visitors need no SW. */
export function CacheBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const retire = () => {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        const ours = registrations.filter((registration) => {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          if (!worker) return false;
          const url = new URL(worker.scriptURL);
          return url.origin === window.location.origin && url.pathname === "/sw.js";
        });
        // update fetches the retirement worker, which claims clients then unregisters.
        await Promise.all(ours.map((registration) => registration.update()));
        if (!ours.length && "caches" in window) await caches.delete("velora-static-v1");
      }).catch(() => { /* Offline/private mode: retry naturally next visit. */ });
    };
    if (document.readyState === "complete") retire();
    else window.addEventListener("load", retire, { once: true });
    return () => window.removeEventListener("load", retire);
  }, []);
  return null;
}
