import { useEffect, useRef, useState } from 'react';
import { openPublicChannel, type PublicState } from '../../lib/rafflePublic';
import type { RaffleScope } from '../../lib/raffleShow';
import { PublicStage } from './RaffleStage';
import './raffle.css';

const PING_MS = 3000;
const HINT_MS = 12000;

const standby = (scope: RaffleScope): PublicState => ({ scope, phase: 'standby', categoryName: null, prize: null, poolCount: 0, result: null });

/**
 * The public screen of the raffle: its own window, for the projector. It shows the stage that the operator's console
 * sends it and nothing else: no navigation, no buttons, no errors. It never talks to the server. Double click or F
 * toggles full screen.
 */
export default function RaffleProjection() {
  const supported = typeof BroadcastChannel !== 'undefined';
  const [state, setState] = useState<PublicState | null>(null);
  const lastScope = useRef<RaffleScope>('real');
  const [hint, setHint] = useState(true);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    document.title = 'Sorteo · pantalla pública';
    const channel = openPublicChannel((message) => {
      if (message.type !== 'state') return;
      if (message.state) lastScope.current = message.state.scope;
      setState(message.state);
    });
    channel?.post({ type: 'hello' });
    const ping = setInterval(() => channel?.post({ type: 'ping' }), PING_MS);
    const bye = () => channel?.post({ type: 'bye' });
    window.addEventListener('pagehide', bye);
    return () => { clearInterval(ping); window.removeEventListener('pagehide', bye); bye(); channel?.close(); };
  }, []);

  useEffect(() => {
    const fullscreen = () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) fullscreen(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dblclick', fullscreen);
    const hide = setTimeout(() => setHint(false), HINT_MS);
    let timer: ReturnType<typeof setTimeout>;
    const awake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(() => setIdle(true), 2500); };
    window.addEventListener('mousemove', awake);
    awake();
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('dblclick', fullscreen); window.removeEventListener('mousemove', awake); clearTimeout(hide); clearTimeout(timer); };
  }, []);

  if (!supported) {
    return <div className="rf-public" data-idle={idle || undefined}><p className="rf-public-note">Este navegador no puede recibir el sorteo desde la consola. Abre esta pantalla en un navegador actual.</p></div>;
  }
  const shown = state ?? standby(lastScope.current);
  return (
    <div className="rf-public" data-idle={idle || undefined}>
      <PublicStage state={shown} />
      {hint && shown.phase === 'standby' && <p className="rf-public-hint">Doble clic o tecla F para pantalla completa</p>}
    </div>
  );
}
