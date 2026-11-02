/** Local timing only: fixed labels, no identity, payloads or persistent cache. */
type SetupStage = 'session_ready' | 'content_visible' | 'usable' | 'entry' | 'workspace' | 'details' | 'owner' | 'initial' | 'connections_before' | 'recheck' | 'connections_after';
/** Fragment-only opt-in stays in this tab; no storage, request parameter or telemetry endpoint. */
function timingEnabled() {
  if (process.env.NODE_ENV === 'development') return true;
  return typeof window !== 'undefined' && window.location.hash === '#velora-performance';
}

/** Snapshot numbers only. Never serialize PerformanceEntry objects or resource URLs. */
function reportDocumentTiming() {
  if (typeof window === 'undefined') return;
  const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
  if(!navigation)return;
  const number=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value):null;
  const milestone=(value:number|undefined)=>value&&value>0?number(value):null;
  const scripts=(performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(entry=>entry.initiatorType==='script');
  const sum=(field:'encodedBodySize'|'decodedBodySize'|'transferSize')=>scripts.reduce((total,entry)=>total+(number(entry[field])??0),0);
  const firstPaint=performance.getEntriesByType('paint').find(entry=>entry.name==='first-contentful-paint');
  console.info(JSON.stringify({
    service:'velora.setup.document',observed_ms:number(performance.now()),
    request_start_ms:milestone(navigation.requestStart),response_start_ms:milestone(navigation.responseStart),response_end_ms:milestone(navigation.responseEnd),
    dom_interactive_ms:milestone(navigation.domInteractive),dom_content_loaded_ms:milestone(navigation.domContentLoadedEventEnd),load_end_ms:milestone(navigation.loadEventEnd),
    first_contentful_paint_ms:milestone(firstPaint?.startTime),document_encoded_bytes:number(navigation.encodedBodySize),
    script_count:scripts.length,script_encoded_bytes:sum('encodedBodySize'),script_decoded_bytes:sum('decodedBodySize'),script_transfer_bytes:sum('transferSize'),
    last_script_response_ms:scripts.length?number(Math.max(...scripts.map(entry=>entry.responseEnd))):null,
    viewport_width:number(window.innerWidth),viewport_height:number(window.innerHeight),
  }));
}
export function setupTiming(stage: SetupStage) {
  const started = performance.now();
  const emit = (phase: 'start' | 'end') => {
    if (!timingEnabled()) return;
    try {
      console.info(JSON.stringify({service:'velora.setup.timing',stage,phase,elapsed_ms:Math.round(performance.now()),duration_ms:Math.round(performance.now()-started)}));
      if(stage==='session_ready'&&phase==='end')reportDocumentTiming();
    } catch { /* Measurement never changes authorization or results. */ }
  };
  emit('start');
  return () => emit('end');
}

/** Observe presentation only, after admission; never reads text, input values or identifiers. */
export function observeSetupUsable(root:HTMLElement,isCurrent:()=>boolean) {
  if(!timingEnabled())return ()=>{};
  let done=false;
  const observer=new MutationObserver(check);
  function check(){
    if(done||!isCurrent())return;
    if(root.closest('[hidden],[inert]')||!root.querySelector('[data-connection-ui-state]'))return;
    if(!root.querySelector('button:not(:disabled),input:not(:disabled)'))return;
    done=true;observer.disconnect();setupTiming('usable')();
  }
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','inert','data-connection-ui-state']});
  for(let parent=root.parentElement;parent;parent=parent.parentElement)observer.observe(parent,{attributes:true,attributeFilter:['hidden','inert']});
  check();return ()=>{done=true;observer.disconnect();};
}
