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
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const onInboxEventRef = useRef(onInboxEvent);
  useEffect(() => {
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

    const params = new URLSearchParams({ company: companyId, branch: branchId, channel });
    let events: EventSource;

    const ready = () => {
      if (!active) return;
      setConnected(true);
      if (hasConnectedOnce) {
        dispatchEvent({ type: 'reconnect' });
      } else {
        hasConnectedOnce = true;
        dispatchEvent({ type: 'ready' });
      }
    };

    const lost = () => {
      if (!active) return;
      setConnected(false);
    };

    const stopRevoked = () => {
      revoked = true;
      clearTimeout(retry);
      events.close();
      setConnected(false);
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
      const current = new EventSource(`/api/branch/inbox-events?${params}`);
      events = current;
      current.addEventListener('ready', ready);
      current.addEventListener('change', (e) => {
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
      current.addEventListener('revoked', stopRevoked);
      current.addEventListener('unavailable', lost);
      current.onerror = () => {
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
        dispatchEvent({ type: 'reconnect' });
      }
    };

    connect();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(retry);
      events.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [companyId, branchId, channel, router]);

  return (
    <p role="status" className="text-sm">
      {connected
        ? (ar ? 'التحديثات المباشرة متصلة' : 'Live updates connected')
        : (ar ? 'جارٍ الاتصال بالتحديثات المباشرة؛ يمكنك تحديث الصفحة.' : 'Connecting to live updates; you can refresh the page.')}
    </p>
  );
}
