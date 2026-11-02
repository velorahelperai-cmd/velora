'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';

export type InboxRealtimeEvent =
  | { type: 'ready' }
  | { type: 'change'; data?: unknown }
  | { type: 'reconnect' }
  | { type: 'revoked' }
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

export function CompanyInboxRealtime({companyId,actorId,ar,onInboxEvent}:{companyId:string;actorId:string;ar:boolean;onInboxEvent:(event:InboxRealtimeEvent)=>void}) {
  return <InboxRealtime url={`/api/inbox/events?${new URLSearchParams({companyId,actorId})}`} ar={ar} onInboxEvent={onInboxEvent}/>;
}

function InboxRealtime({url,ar,onInboxEvent}:{url:string;ar:boolean;onInboxEvent?: (event:InboxRealtimeEvent)=>void}) {
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
      onInboxEventRef.current?.({ type: 'unavailable' });
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
      if (!active || revoked) return;
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
      current.addEventListener('unavailable', () => { if (isCurrent()) lost(); });
      current.onerror = () => {
        if (!isCurrent()) return;
        lost();
        if (active && !revoked && current.readyState === EventSource.CLOSED && retry === undefined) {
          retry = setTimeout(() => {
            retry = undefined;
            current.close();
            connect();
          }, 5000);
        }
      };
    };

    const visible = () => {
      if (document.visibilityState === 'visible') {
        if(!events&&!revoked){connect();return;}
        // Returning to the tab requests reconciliation, not proof that the
        // transport reconnected. Only the server's ready event proves that.
        dispatchEvent({ type: 'change' });
      } else {
        clearTimeout(retry);retry=undefined;
        events?.close();events=undefined;
        lost();
      }
    };

    if(document.visibilityState==='visible')connect();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(retry);
      events?.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [url, router]);

  return (
    <p role="status" className="text-sm">
      {connectedUrl===url
        ? (ar ? 'التحديثات المباشرة متصلة' : 'Live updates connected')
        : (ar ? 'جارٍ الاتصال بالتحديثات المباشرة؛ يمكنك تحديث الصفحة.' : 'Connecting to live updates; you can refresh the page.')}
    </p>
  );
}
