import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from '../lib/adminApi';
import { resetSeenMemory, type MyRafflePrize } from '../lib/raffleWinner';
import { neutralTheme } from '../theme/neutralTheme';
import ExitSurveyCard from './ExitSurveyCard';
import ExitSurveyInvite, { MAX_CLAIM_ATTEMPTS } from './ExitSurveyInvite';
import { ExitSurveyProvider } from './ExitSurveyProvider';
import { openModalCount } from './backgroundLock';
import WinnerNotice from './WinnerNotice';

vi.mock('../lib/adminApi', () => ({ rpc: vi.fn() }));
const prizes = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('./RafflePrizeProvider', () => ({ useRafflePrizes: () => ({ prizes: prizes.current, verified: true, loaded: true, refresh: async () => undefined }) }));
vi.mock('../theme/PublicThemeProvider', () => ({ usePublicTheme: () => ({ theme: neutralTheme }) }));

type Server = { now: string; completed: boolean; invitedAt: string | null; failClaims: number; dropClaimResponse: boolean };
let server: Server;
let claimCalls: number;
const view = (extra: Record<string, unknown> = {}) => ({
  version: 'exit-2026-v1', opens_at: '2026-10-15T18:00:00Z', server_now: server.now, is_open: Date.parse(server.now) >= Date.parse('2026-10-15T18:00:00Z'),
  completed: server.completed, completed_at: null, invited_at: server.invitedAt, has_won: false, stamps_category_id: null, stamps_category_name: null,
  stamps_met: false, eligible: false, ...extra,
});

/** Un servidor con reclamo atómico (la primera solicitud gana) y fallas de conexión programables. */
function mockServer() {
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'my_exit_survey') return view();
    if (name === 'exit_survey_mark_invited') {
      claimCalls += 1;
      await Promise.resolve(); // la solicitud sale y vuelve; la atomicidad la da el servidor, no el orden de llegada
      if (server.failClaims > 0) { server.failClaims -= 1; throw { message: 'TypeError: Failed to fetch' }; }
      const claimed = !server.completed && server.invitedAt === null;
      if (claimed) server.invitedAt = server.now;
      if (server.dropClaimResponse && claimed) { server.dropClaimResponse = false; throw { message: 'TypeError: Failed to fetch' }; } // se guardó, pero la respuesta se perdió
      return view({ claimed });
    }
    throw new Error(`rpc inesperado ${name}`);
  });
}

const winnerPrize: MyRafflePrize = { winnerId: 'w1', folio: 'GAN-000123', status: 'seleccionado', prizeName: 'Nintendo Switch OLED', categoryName: 'Galaxia', displayName: 'Valeria', drawnAt: '2026-10-15T19:00:00Z', confirmedAt: null };

function Go({ to, label }: { to: string; label: string }) { const navigate = useNavigate(); return <button onClick={() => navigate(to)}>{label}</button>; }
const device = (path = '/bitacora') => (
  <MemoryRouter initialEntries={[path]}>
    <ExitSurveyProvider>
      <Routes>
        <Route path="/bitacora" element={<div><p>Inicio</p><Go to="/escanear" label="ir-escanear" /></div>} />
        <Route path="/escanear" element={<div><p>Escáner</p><Go to="/bitacora" label="salir-escaner" /></div>} />
        <Route path="/encuesta" element={<p>Encuesta</p>} />
      </Routes>
      <ExitSurveyCard />
      <ExitSurveyInvite />
      <WinnerNotice />
    </ExitSurveyProvider>
  </MemoryRouter>
);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  prizes.current = [];
  resetSeenMemory();
  server = { now: '2026-10-15T19:00:00Z', completed: false, invitedAt: null, failClaims: 0, dropClaimResponse: false };
  claimCalls = 0;
  mockServer();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const dialogs = () => screen.queryAllByRole('alertdialog');
const survey = () => dialogs().filter((node) => node.hasAttribute('data-exit-survey-dialog'));
const winner = () => dialogs().filter((node) => !node.hasAttribute('data-exit-survey-dialog'));
const root = () => document.getElementById('root')!;

describe('invitación única: dos pestañas o dispositivos a la vez', () => {
  test('con tres dispositivos simultáneos el servidor concede el derecho a UNO y solo ese abre el popup; los demás conservan la Bitácora', async () => {
    fake();
    const first = render(device()); const second = render(device()); const third = render(device());
    await tick(200);
    expect(survey()).toHaveLength(1); // un solo popup en todo el sistema
    expect(claimCalls).toBe(3); // los tres lo pidieron; uno ganó
    expect(server.invitedAt).not.toBeNull();
    // Los otros dos siguen teniendo la sección en la Bitácora (acceso permanente), sin popup.
    for (const view of [first, second, third]) {
      expect(view.container.querySelector('#encuesta')).not.toBeNull();
      expect(view.container.querySelector('a[href="/encuesta"]')).not.toBeNull();
    }
    await tick(120_000);
    expect(survey()).toHaveLength(1);
    expect(claimCalls).toBe(3); // y no insisten
  });

  test('quien ya fue invitado en otro dispositivo no abre nada al llegar tarde, ni reclama de nuevo con éxito', async () => {
    fake();
    server.invitedAt = '2026-10-15T18:30:00Z';
    render(device());
    await tick(500);
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(0); // el estado ya decía «invitado»: ni siquiera lo pide
    expect(screen.getByRole('link', { name: 'Responder encuesta' })).toBeInTheDocument();
  });

  test('si el estado de este dispositivo estaba desactualizado, el reclamo responde «no» y tampoco se abre', async () => {
    fake();
    // el dispositivo cree que nadie lo invitó, pero otro se adelantó entre la lectura y el reclamo
    vi.mocked(rpc).mockImplementation(async (name: string) => {
      if (name === 'my_exit_survey') return view({ invited_at: null });
      if (name === 'exit_survey_mark_invited') { claimCalls += 1; return view({ claimed: false, invited_at: '2026-10-15T19:00:00Z' }); }
      throw new Error('rpc');
    });
    render(device());
    await tick(300);
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(1);
  });
});

describe('fallas temporales de conexión', () => {
  test('sin confirmación del servidor NO se abre el popup; al recuperarse el reclamo se reintenta (acotado) y entonces sí', async () => {
    fake();
    server.failClaims = 2;
    render(device());
    await tick(500);
    expect(survey()).toHaveLength(0); // falló el primer reclamo: no se sabe si se obtuvo
    await tick(45_000);
    expect(survey()).toHaveLength(0); // falló el segundo
    await tick(90_000);
    expect(survey()).toHaveLength(1); // el tercero respondió: este dispositivo obtuvo el derecho
    expect(claimCalls).toBe(3);
  });

  test('el reintento está acotado: tras agotarlo no insiste y la Bitácora sigue disponible', async () => {
    fake();
    server.failClaims = 99;
    render(device());
    for (let minute = 0; minute < 10; minute += 1) await tick(60_000); // cada intento necesita que React se asiente entre uno y otro
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(1 + MAX_CLAIM_ATTEMPTS);
    for (let minute = 0; minute < 10; minute += 1) await tick(60_000);
    expect(claimCalls).toBe(1 + MAX_CLAIM_ATTEMPTS); // nada sigue corriendo
    expect(screen.getByRole('link', { name: 'Responder encuesta' })).toHaveAttribute('href', '/encuesta');
  });

  test('si el servidor la concedió pero la respuesta se perdió, nadie la muestra (una sola vez es una sola vez) y la Bitácora queda', async () => {
    fake();
    server.dropClaimResponse = true;
    render(device());
    await tick(200);
    expect(survey()).toHaveLength(0);
    await tick(120_000);
    expect(survey()).toHaveLength(0); // el reintento recibió «ya reclamado»
    expect(screen.getByRole('link', { name: 'Responder encuesta' })).toBeInTheDocument();
  });
});

describe('prioridad: la encuesta nunca compite con otra ventana', () => {
  test('con el aviso de ganador abierto al cargar, la encuesta ni siquiera reclama su derecho; al cerrarlo y asentarse, aparece', async () => {
    fake();
    prizes.current = [winnerPrize];
    render(device());
    await tick(500);
    expect(winner()).toHaveLength(1);
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(0); // no se «gasta» el derecho mientras hay algo más importante
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    prizes.current = [];
    await tick(500);
    expect(survey()).toHaveLength(0);
    await tick(3000);
    expect(survey()).toHaveLength(1);
    expect(winner()).toHaveLength(0);
  });

  test('si el aviso de ganador aparece con el popup de la encuesta ABIERTO, la encuesta se retira, el ganador queda solo y al terminar la encuesta vuelve', async () => {
    fake();
    const view = render(device());
    await tick(300);
    expect(survey()).toHaveLength(1);
    expect(root()).toHaveAttribute('inert');
    const before = claimCalls;

    prizes.current = [winnerPrize];
    view.rerender(device());
    await tick(100);
    expect(winner()).toHaveLength(1);
    expect(survey()).toHaveLength(0); // se retiró: no hay dos ventanas
    expect(dialogs()).toHaveLength(1);
    expect(winner()[0].contains(document.activeElement)).toBe(true); // el foco es del ganador, sin disputa
    expect(root()).toHaveAttribute('inert'); // el fondo sigue bloqueado por el diálogo prioritario
    expect(openModalCount()).toBe(1);
    expect(claimCalls).toBe(before); // y no se volvió a reclamar nada

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    prizes.current = [];
    view.rerender(device());
    await tick(100);
    expect(winner()).toHaveLength(0);
    expect(survey()).toHaveLength(0); // se asienta unos segundos
    await tick(3000);
    expect(survey()).toHaveLength(1); // conserva el derecho que ya había obtenido
    expect(claimCalls).toBe(before);
    expect(openModalCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    await tick(100);
    expect(dialogs()).toHaveLength(0);
    expect(openModalCount()).toBe(0);
    expect(root()).not.toHaveAttribute('inert'); // el bloqueo se restituye: la aplicación queda usable
    expect(root()).not.toHaveAttribute('aria-hidden');
  });

  test('los bloqueos de fondo se cuentan: abrir uno encima de otro y cerrarlos en cualquier orden restituye la raíz exactamente', async () => {
    fake();
    const view = render(device());
    await tick(300);
    expect(survey()).toHaveLength(1);
    prizes.current = [winnerPrize];
    view.rerender(device()); await tick(50);
    expect(root()).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); prizes.current = []; view.rerender(device()); await tick(50);
    await tick(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Responder encuesta' })); await tick(50);
    expect(openModalCount()).toBe(0);
    expect(root().hasAttribute('inert')).toBe(false);
    expect(root().hasAttribute('aria-hidden')).toBe(false);
  });

  test('el popup de la encuesta no se toma a sí mismo por otro modal prioritario: sigue abierto sin parpadear', async () => {
    fake();
    render(device());
    await tick(300);
    expect(survey()).toHaveLength(1);
    await tick(10_000);
    expect(survey()).toHaveLength(1);
    expect(claimCalls).toBe(1);
  });

  test('con el popup abierto, si la persona termina en el escáner (navegación), se retira y vuelve al salir; «Ahora no» lo cierra para siempre', async () => {
    fake();
    render(device());
    await tick(300);
    expect(survey()).toHaveLength(1);
    // Algo (p. ej. un enlace profundo) la lleva al escáner mientras el popup está abierto.
    act(() => { root().removeAttribute('inert'); });
    fireEvent.click(screen.getByRole('button', { name: 'ir-escanear' }));
    await tick(100);
    expect(survey()).toHaveLength(0);
    await tick(30_000);
    expect(survey()).toHaveLength(0); // sigue escaneando
    fireEvent.click(screen.getByRole('button', { name: 'salir-escaner' }));
    await tick(500);
    expect(survey()).toHaveLength(0);
    await tick(3000);
    expect(survey()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    await tick(120_000);
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(1);
  });

  test('un ganador histórico de ensayo (resultado ya entregado, de antes de la encuesta) no es un aviso: la invitación sale y su premio no se toca', async () => {
    fake();
    prizes.current = [{ ...winnerPrize, status: 'confirmado', confirmedAt: '2026-10-15T18:50:00Z' }];
    render(device());
    await tick(300);
    expect(winner()).toHaveLength(0);
    expect(survey()).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalledWith('submit_exit_survey', expect.anything());
    expect(prizes.current).toHaveLength(1);
  });

  test('una confirmación crítica abierta (reservar / cancelar) también la pospone', async () => {
    fake();
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.appendChild(modal);
    render(device());
    await tick(500);
    expect(survey()).toHaveLength(0);
    expect(claimCalls).toBe(0);
    modal.remove();
    await tick(100);
    expect(survey()).toHaveLength(0); // acaba de cerrarse: se asienta
    await tick(3000);
    expect(survey()).toHaveLength(1);
  });
});
