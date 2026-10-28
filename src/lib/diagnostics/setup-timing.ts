/** Local timing only: fixed labels, no identity, payloads or persistent cache. */
type SetupStage = 'session_ready' | 'content_visible' | 'usable' | 'entry' | 'workspace' | 'details' | 'owner' | 'initial' | 'connections_before' | 'recheck' | 'connections_after';
export function setupTiming(stage: SetupStage) {
  const started = performance.now();
  const emit = (phase: 'start' | 'end') => {
    if (process.env.NODE_ENV !== 'development') return;
    try {
      console.info(JSON.stringify({service:'velora.setup.timing',stage,phase,elapsed_ms:Math.round(performance.now()),duration_ms:Math.round(performance.now()-started)}));
    } catch { /* Measurement never changes authorization or results. */ }
  };
  emit('start');
  return () => emit('end');
}

/** Observe presentation only, after admission; never reads text, input values or identifiers. */
export function observeSetupUsable(root:HTMLElement,isCurrent:()=>boolean) {
  if(process.env.NODE_ENV!=='development')return ()=>{};
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
