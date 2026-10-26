// A short message at the bottom of the screen that goes away by itself.
import {useEffect, useRef} from 'react';
import {hideToast, showToast, useUi} from '../../store/ui';
import {useServer} from '../../store/dashboard';

export function Toast() {
  const toast = useUi(s => s.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hideToast, toast.ms);
    return () => clearTimeout(timer);
  }, [toast]);
  return toast ? <div className="toast">{toast.content}</div> : null;
}

/** Tells the player, once per mismatch, when the game sends another telemetry format than the one they picked. */
export function useFormatWarning(): void {
  const sent = useServer(s => s?.session?.packetFormat);
  const chosen = useUi(s => s.format);
  const warned = useRef<number | null>(null);
  useEffect(() => {
    if (!chosen || !sent || String(sent) === chosen || warned.current === sent) return;
    warned.current = sent;
    showToast(
      <>
        The game is sending UDP format <b>{sent}</b>, not {chosen}. Showing {sent} data.
      </>,
      8000
    );
  }, [sent, chosen]);
}
