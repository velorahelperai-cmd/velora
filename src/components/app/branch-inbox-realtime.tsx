'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';

export type InboxRealtimeEvent =
  | { type: 'ready' }
  | { type: 'change'; data?: unknown }
  | { type: 'reconnect' }
  | { type: 'revoked' }
  | { type: 'disconnected' }
  | { type: 'unavailable' };

export function BranchInboxRealtime({
  companyId,
  branchId,
  channel,
  ar,
  onInboxEvent,
}: {
  companyId: string;
  branchId: string;
  channel: string;
  ar: boolean;
  onInboxEvent?: (event: InboxRealtimeEvent) => void;
}) {
  return <InboxRealtime url={`/api/branch/inbox-events?${new URLSearchParams({company:companyId,branch:branchId,channel})}`} ar={ar} onInboxEvent={onInboxEvent}/>;
}

export function CompanyInboxRealtime({companyId,actorId,ar,onInboxEvent,separateTransport=false}:{companyId:string;actorId:string;ar:boolean;separateTransport?:boolean;onInboxEvent:(event:InboxRealtimeEvent)=>void}) {
  return <InboxRealtime url={`/api/inbox/events?${new URLSearchParams({companyId,actorId})}`} ar={ar} onInboxEvent={onInboxEvent} separateTransport={separateTransport}/>;
}

function InboxRealtime({url,ar,onInboxEvent,separateTransport=false}:{url:string;ar:boolean;separateTransport?:boolean;onInboxEvent?: (event:InboxRealtimeEvent)=>void}) {
  const router = useRouter();
  const [connectedUrl, setConnectedUrl] = useState<string|null>(null);
  const onInboxEventRef = useRef(onInboxEvent);
  useEffect(() => {
    if(typeof EventSource==='undefined'){
      onInboxEventRef.current?.({type:'unavailable'});
      return;
    }
    onInboxEventRef.current = onInboxEvent;
  }, [onInboxEvent]);

  useEffect(() => {
    let active = true;
    let revoked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let hasConnectedOnce = false;
    let attempts = 0;

    const dispatchEvent = (event: InboxRealtimeEvent) => {
      if (!active) return;
      if (onInboxEventRef.current) {
        onInboxEventRef.current(event);
      } else {
        if (timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            if (active) router.refresh();
          }, 250);
        }
      }
    };

    let events: EventSource|undefined;

    const ready = () => {
      if (!active) return;
      setConnectedUrl(url);
      attempts = 0;
      if (hasConnectedOnce) {
        dispatchEvent({ type: 'reconnect' });
      } else {
        hasConnectedOnce = true;
        dispatchEvent({ type: 'ready' });
      }
    };

    const lost = () => {
      if (!active) return;
      setConnectedUrl(null);
      // A consumer needs transport state to enable its fallback reads.
      onInboxEventRef.current?.({ type: separateTransport?'disconnected':'unavailable' });
    };

    const stopRevoked = () => {
      revoked = true;
      clearTimeout(retry);
      events?.close();
      setConnectedUrl(null);
      if (active) {
        if (onInboxEventRef.current) {
          onInboxEventRef.current({ type: 'revoked' });
        }
        if (timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            if (active) router.refresh();
          }, 250);
        }
      }
    };

    const connect = () => {
      if (!active || revoked || typeof EventSource==='undefined') return;
      const current = new EventSource(url);
      events = current;
      const isCurrent = () => active && !revoked && events === current;
      current.addEventListener('ready', () => { if (isCurrent()) ready(); });
      current.addEventListener('change', (e) => {
        if (!isCurrent()) return;
        let data: unknown;
        try {
          if (e instanceof MessageEvent && typeof e.data === 'string' && e.data.trim()) {
            data = JSON.parse(e.data);
          }
        } catch {
          data = undefined;
        }
        dispatchEvent({ type: 'change', data });
      });
      current.addEventListener('revoked', () => { if (isCurrent()) stopRevoked(); });
      const retryConnection = () => {
        if (!isCurrent()) return;
        current.close();events=undefined; // Disable native unbounded retries.
        lost();
        if (active && !revoked && document.visibilityState==='visible' && attempts < 5 && retry === undefined) {
          const delay = Math.min(30000,1000 * 2 ** attempts++) * (0.75 + Math.random() * 0.5);
          retry = setTimeout(() => {
            retry = undefined;
            connect();
          }, delay);
        }
      };
      current.addEventListener('unavailable', () => {
        if (!isCurrent()) return;
        onInboxEventRef.current?.({type:'unavailable'});
        retryConnection();
      });
      current.addEventListener('renew', () => {
        if(!isCurrent())return;
        // Server just reverified authority. Rotate without a false failure.
        current.close();events=undefined;
        retry=setTimeout(()=>{retry=undefined;connect();},250+Math.random()*250);
      });
      current.onerror = retryConnection;
    };

    const visible = () => {
      if (document.visibilityState === 'visible') {
        if(!events&&!revoked&&retry===undefined){attempts=0;connect();return;}
        // Returning to the tab requests reconciliation, not proof that the
        // transport reconnected. Only the server's ready event proves that.
        if(!separateTransport)dispatchEvent({ type: 'change' });
      } else {
        clearTimeout(retry);retry=undefined;
        events?.close();events=undefined;
        lost();
      }
    };

    if(document.visibilityState==='visible')connect();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(retry);
      events?.close();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [url, router, separateTransport]);

  return (
    <p role="status" className="text-sm">
      {connectedUrl===url
        ? (ar ? 'التحديثات المباشرة متصلة' : 'Live updates connected')
        : (ar ? 'جارٍ الاتصال بالتحديثات المباشرة؛ يمكنك تحديث الصفحة.' : 'Connecting to live updates; you can refresh the page.')}
    </p>
  );
}
