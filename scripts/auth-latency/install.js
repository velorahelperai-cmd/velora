/* Paste into the verification tab's DevTools Console. Observation only: no auth calls. */
(() => {
  if (!['www.velorahelper.com', 'velorahelper.com', 'localhost', '127.0.0.1'].includes(location.hostname)) {
    throw new Error('VELORA_TIMING_ORIGIN_REQUIRED');
  }
  if (window.veloraAuthTiming?.active) return;
  const key = 'velora.auth.timing.v1';
  const started = Date.now();
  const origin = performance.now();
  const events = [];
  const removers = [];
  const pending = new Set();
  const seen = new Set();
  let active = true, sequence = 0;
  const pathOf = value => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return null;
      return /^\/(?:login|signup|verify-email|setup|complete-profile|app|account|access|auth\/broker\/continuity)(?:\/|$)/.test(url.pathname)
        ? url.pathname.split('/').slice(0, url.pathname.startsWith('/auth/') ? 4 : 2).join('/') : null;
    } catch { return null; }
  };
  const record = (event, detail = {}) => {
    if (!active || events.length >= 800) return;
    events.push({event, elapsed_ms: Math.round(performance.now() - origin), utc: new Date().toISOString(), ...detail});
  };
  const report = () => ({version: 1, started_utc: new Date(started).toISOString(), origin: location.origin,
    limits: ['Client observation only; provider/admission timestamps require server logs.', 'Fetch headers and resource responseEnd are distinct.', 'No request/response bodies, input values, cookies, tokens, email or text content captured.', 'Refresh loses instrumentation; pagehide saves only sanitized timing records to this tab sessionStorage.'],
    events: events.map(e => ({...e}))});
  const save = () => {try {sessionStorage.setItem(key, JSON.stringify(report()));} catch { /* optional local receipt */ }};
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    removers.push(() => target.removeEventListener(type, fn, options));
  };
  const originalFetch = window.fetch;
  const fetchWrapper = async function(input, init) {
    const path = pathOf(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (!path) return originalFetch.call(this, input, init);
    const id = ++sequence;
    const method = (init?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const safeMethod = ['GET','POST','HEAD'].includes(method) ? method : 'OTHER';
    pending.add(id);record('fetch_start', {id, path, method: safeMethod});
    try {
      const response = await originalFetch.call(this, input, init);
      record('fetch_headers', {id, path, status: response.status});return response;
    } catch (error) {record('fetch_transport_error', {id, path});throw error;}
    finally {pending.delete(id);}
  };
  if (originalFetch) window.fetch = fetchWrapper;
  removers.push(() => {if (window.fetch === fetchWrapper) window.fetch = originalFetch;});

  const originalInfo = console.info;
  const stages = new Set(['input','session','provider','profile','access','persistence','readiness','workspace','permissions','refresh','completed','handoff','claim','receipt','delivery','preflight','code_exchange','finalize','unknown']);
  const codes = new Set(['STARTED','OK','INVALID_INPUT','AUTH_ERROR','UNAVAILABLE','UNAUTHENTICATED','UNVERIFIED','FORBIDDEN','CONFLICT','NO_COMPANY','DEPENDENCY_FAILED','REFRESH_FAILED','UNEXPECTED_FAILURE','PROVIDER_REJECTED','OUTCOME_UNKNOWN','DISABLED']);
  const infoWrapper = function(...args) {
    try {
      if (typeof args[0] === 'string' && args[0].length < 4096) {
        const row = JSON.parse(args[0]);
        if (row.service === 'velora.auth' && /^auth_(?:continuity|session_check|signup|login|verification|verification_resend)$/.test(row.operation)
          && stages.has(row.stage) && codes.has(row.code)) {
          const safe = {operation: row.operation, stage: row.stage, code: row.code};
          for (const [field, pattern] of [['request_id', /^VEL-[A-F0-9]{16}$/], ['trace_id', /^[a-f0-9]{32}$/], ['span_id', /^[a-f0-9]{16}$/]]) {
            if (typeof row[field] === 'string' && pattern.test(row[field])) safe[field] = row[field];
          }
          if (Number.isFinite(row.duration_ms) && row.duration_ms >= 0 && row.duration_ms <= 86400000) safe.trace_elapsed_ms = row.duration_ms;
          record('diagnostic', safe);
        }
      }
    } catch { /* arbitrary console output is not collected */ }
    return originalInfo.apply(this, args);
  };
  console.info = infoWrapper;
  removers.push(() => {if (console.info === infoWrapper) console.info = originalInfo;});

  function observeDom() {
    const path = pathOf(location.href);
    const modal = document.querySelector('[data-auth-otp-modal]');
    const milestones = [
      ['verification_wait_visible', modal?.getAttribute('aria-busy') === 'true'],
      ['verified_graphic_started', !!document.querySelector('[data-auth-otp-confirmed="true"]')],
      ['success_visible', modal?.getAttribute('data-auth-otp-phase') === 'done'],
      ['destination_loading', !!document.querySelector('[data-approved-loader]')],
      ['destination_content', path && !['/verify-email','/login','/signup'].includes(path)
        && !document.querySelector('[data-approved-loader]') && !modal
        && !!document.querySelector('[data-setup-studio],main[data-internal-ui],main:not([data-auth-entry-shell])')],
    ];
    for (const [name, reached] of milestones) {
      const token = `${path}:${name}`;
      if (reached && !seen.has(token)) {seen.add(token);record(name, {path});}
    }
  }
  const observer = new MutationObserver(observeDom);
  observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['aria-busy','data-auth-otp-phase','data-auth-otp-confirmed']});
  removers.push(() => observer.disconnect());
  on(document, 'input', event => {
    if (event.target instanceof HTMLElement && event.target.matches('[data-auth-otp-cell="5"]')) record('last_cell_input_gesture');
  }, true);
  on(document, 'paste', event => {
    if (event.target instanceof HTMLElement && event.target.closest('[data-auth-otp-modal]')) record('otp_paste_gesture');
  }, true);
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    const wrapper = function(...args) {
      const value = original.apply(this, args);
      const path = pathOf(location.href);if (path) record('history_commit', {path});observeDom();return value;
    };
    history[method] = wrapper;
    removers.push(() => {if (history[method] === wrapper) history[method] = original;});
  }
  on(window, 'popstate', () => {record('popstate', {path:pathOf(location.href)});observeDom();});
  on(window, 'pagehide', () => {record('pagehide', {path:pathOf(location.href)});save();});
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const resources = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const path = pathOf(entry.name);
          if (path && entry.startTime >= origin) record('resource_complete', {path, duration_ms:Math.round(entry.duration), ttfb_ms:Math.round(entry.responseStart-entry.startTime), start_elapsed_ms:Math.round(entry.startTime-origin)});
        }
      });
      resources.observe({type:'resource', buffered:false});removers.push(() => resources.disconnect());
    } catch {record('resource_observer_unavailable');}
  }
  const timer = setInterval(() => {if (pending.size) record('pending_headers_30s', {requests:pending.size});}, 30000);
  removers.push(() => clearInterval(timer));
  window.veloraAuthTiming = {
    get active() {return active;}, report,
    stop() {save();active = false;removers.splice(0).reverse().forEach(remove => remove());return report();},
    download() {
      save();const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], {type:'application/json'}));
      const link = document.createElement('a');link.href = url;link.download = 'velora-auth-timing.json';link.click();URL.revokeObjectURL(url);
    },
  };
  record('recorder_installed', {path:pathOf(location.href)});observeDom();
  originalInfo.call(console, 'Velora timing ready. No authentication request was made.');
})();
