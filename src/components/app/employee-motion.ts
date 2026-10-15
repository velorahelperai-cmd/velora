const preference = '(prefers-reduced-motion: reduce)';
export function readEmployeeMotion() { return !document.hidden && !window.matchMedia(preference).matches; }
export function subscribeEmployeeMotion(notify: () => void) {
  const media = window.matchMedia(preference);
  document.addEventListener('visibilitychange', notify);
  media.addEventListener('change', notify);
  return () => { document.removeEventListener('visibilitychange', notify); media.removeEventListener('change', notify); };
}
