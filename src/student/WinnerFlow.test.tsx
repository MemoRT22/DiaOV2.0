import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from '../lib/adminApi';
import { resetSeenMemory } from '../lib/raffleWinner';
import { neutralTheme } from '../theme/neutralTheme';
import PassportPage from './PassportPage';
import { RafflePrizeProvider } from './RafflePrizeProvider';
import WinnerNotice from './WinnerNotice';

const m = vi.hoisted(() => ({ fetchProgress: vi.fn(), fetchDivisions: vi.fn(), fetchMyRaffleStatus: vi.fn(), listeners: [] as Array<(kind: string) => void> }));
// «Otra pestaña» del mismo navegador: la prueba dispara lo que anunciaría.
vi.mock('../lib/participantSync', () => ({
  announceParticipantChange: vi.fn(),
  subscribeParticipantChanges: (cb: (kind: string) => void) => { m.listeners.push(cb); return () => { m.listeners = m.listeners.filter((l) => l !== cb); }; },
}));
vi.mock('../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../lib/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/catalog')>()), fetchProgress: m.fetchProgress, fetchDivisions: m.fetchDivisions }));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.fetchMyRaffleStatus }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Valeria Méndez Castillo' }, signOut: vi.fn() }) }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { interests_prompt_at: null } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    term: (key: 'stamp' | 'division' | 'rank' | 'passport', plural = false) => (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));

type Row = { id: string; participant: string; folio: string; status: string; prize: string; category: string; name: string };
/** Un servidor mínimo que replica el contrato de `my_raffle_prizes`: solo los resultados vigentes de LA persona autenticada. */
/** `forcePoll`: cadencia fija (las pruebas de aviso); `undefined`: la calcula como el servidor real. */
const db = { rows: [] as Row[], me: 'A', offline: false, calls: [] as string[], forcePoll: 20 as number | undefined, attended: true, eligible: true };
const A: Row = { id: 'w-a', participant: 'A', folio: 'GAN-000123', status: 'seleccionado', prize: 'Nintendo Switch OLED', category: 'Galaxia', name: 'Valeria Méndez Castillo' };
const B: Row = { id: 'w-b', participant: 'B', folio: 'GAN-000124', status: 'seleccionado', prize: 'Tarjeta de regalo Amazon', category: 'Sistema Solar', name: 'Valeria Méndez Castillo' };

const progress = () => ({ level: 1, stamps: 2, attended_workshops: 2, reserved_workshops: 0, division_ids: [], next: null, consent_accepted: true, post_event_interests_prompt: false, post_event_interests_open: false, post_event_interests_completed: false });
const status = () => ({ academic_stamps: 2, university_life_stamps: 1, total_stamps: 3, raffle_category: 'ga', raffle_category_name: 'Galaxia', has_won: db.rows.some((r) => r.participant === db.me && ['seleccionado', 'confirmado'].includes(r.status)), categories: [] });

function Where() { const { pathname, hash } = useLocation(); return <p data-testid="where">{pathname}{hash}</p>; }
const app = (start = '/ruta') => render(
  <MemoryRouter initialEntries={[start]}>
    <RafflePrizeProvider>
      <WinnerNotice />
      <Where />
      <Routes>
        <Route path="/ruta" element={<p>Mi ruta</p>} />
        <Route path="/bitacora" element={<p>Inicio</p>} />
        <Route path="/pasaporte" element={<PassportPage />} />
      </Routes>
    </RafflePrizeProvider>
  </MemoryRouter>,
);
const popup = () => screen.queryByRole('alertdialog');
/** `findBy*` de Testing Library espera con temporizadores reales; con temporizadores simulados se avanza el reloj y se reintenta. */
const find = async <T,>(get: () => T): Promise<T> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return get(); } catch { await tick(50); }
  }
  return get();
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  window.localStorage.clear(); resetSeenMemory();
  db.rows = []; db.me = 'A'; db.offline = false; db.calls = []; db.forcePoll = 20; db.attended = true; db.eligible = true; m.listeners = [];
  m.fetchProgress.mockResolvedValue(progress());
  m.fetchDivisions.mockResolvedValue([]);
  m.fetchMyRaffleStatus.mockImplementation(async () => status());
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    db.calls.push(name);
    if (db.offline) throw new TypeError('Failed to fetch');
    if (name !== 'my_raffle_prizes') throw new Error(`rpc inesperada ${name}`);
    const prizes = db.rows.filter((r) => r.participant === db.me && ['seleccionado', 'confirmado'].includes(r.status)).map((r) => ({
      winner_id: r.id, folio: r.folio, status: r.status, prize_name: r.prize, category_name: r.category, display_name: r.name, drawn_at: '2026-10-22T16:00:00Z', confirmed_at: r.status === 'confirmado' ? '2026-10-22T16:05:00Z' : null,
    }));
    // Mismas reglas que `my_raffle_prizes()` en la base.
    const live = db.rows.some((r) => ['seleccionado', 'confirmado'].includes(r.status));
    const pending = prizes.some((p) => p.status === 'seleccionado');
    const model = pending ? 15 : db.attended ? (db.eligible ? (live ? 20 : 180) : (live ? 120 : 300)) : (live ? 120 : 600);
    return { prizes, poll_seconds: db.forcePoll ?? model };
  }) as never);
});
afterEach(() => { vi.useRealTimers(); });

describe('el alumno gana', () => {
  test('mientras navega por otra sección recibe el aviso con su premio, su nombre y su folio', async () => {
    app('/ruta');
    await tick(10);
    expect(popup()).toBeNull(); // todavía no ganó
    db.rows = [A];
    await tick(25_000); // la siguiente consulta periódica
    const dialog = await find(() => screen.getByRole('alertdialog'));
    expect(screen.getByTestId('where')).toHaveTextContent('/ruta'); // sigue en otra sección, no en la Bitácora
    expect(within(dialog).getByRole('heading', { name: /¡Felicidades, eres ganador!/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/Has ganado un premio en el Sorteo/)).toBeInTheDocument();
    expect(within(dialog).getByText('Nintendo Switch OLED')).toBeInTheDocument();
    expect(within(dialog).getByText('Valeria Méndez Castillo')).toBeInTheDocument();
    expect(within(dialog).getByText('GAN-000123')).toBeInTheDocument();
    expect(within(dialog).getByText('Presenta tu Bitácora Digital al personal encargado para recoger tu premio.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ver mi premio' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  test('«Ver mi premio» lleva a la tarjeta de la Bitácora; no se pierde nada al cerrar', async () => {
    db.rows = [A];
    app('/ruta');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Ver mi premio' })));
    expect(popup()).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/pasaporte#premio');
    const card = await find(() => screen.getByRole('article', { name: 'Premio pendiente de entrega' }));
    expect(within(card).getByRole('heading', { name: '¡Ganaste!' })).toBeInTheDocument();
    expect(within(card).getByTestId('prize-name')).toHaveTextContent('Nintendo Switch OLED');
    expect(within(card).getByText('GAN-000123')).toBeInTheDocument();
    expect(within(card).getByText('Galaxia')).toBeInTheDocument();
    expect(within(card).getByText('Pendiente de entrega')).toBeInTheDocument();
    expect(within(card).getByText('Presenta esta pantalla para reclamar tu premio.')).toBeInTheDocument();
  });

  test('«Cerrar» oculta el aviso y no vuelve a salir al navegar, consultar de nuevo ni actualizar la página; el premio sigue en la Bitácora', async () => {
    db.rows = [A];
    const first = app('/ruta');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    expect(popup()).toBeNull();
    await tick(90_000); // varias consultas periódicas más
    expect(popup()).toBeNull();
    first.unmount();
    app('/ruta'); // actualizar la página = montar de nuevo
    await tick(50);
    expect(popup()).toBeNull();
    app('/pasaporte');
    expect(await find(() => screen.getAllByRole('article', { name: 'Premio pendiente de entrega' }))).not.toHaveLength(0);
  });

  test('una consulta repetida no duplica resultados ni avisos', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(100_000);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });

  test('si nunca vio el aviso (otra sesión, recarga, nuevo inicio de sesión) se le muestra una vez', async () => {
    db.rows = [A];
    const first = app('/ruta');
    await tick(10);
    expect(popup()).not.toBeNull();
    first.unmount(); // cerró la pestaña sin cerrar el aviso
    app('/bitacora');
    await tick(10);
    expect(popup()).not.toBeNull();
  });

  test('el aviso aparece sin recargar cuando la persona vuelve a la pestaña', async () => {
    app('/ruta');
    await tick(10);
    db.rows = [A];
    await tick(12_000); // pasó el mínimo entre consultas disparadas por eventos
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(10); });
    expect(popup()).not.toBeNull();
  });
});

describe('estados del resultado', () => {
  test('entregado: la tarjeta lo dice y ya no pide recoger; no hay aviso', async () => {
    db.rows = [{ ...A, status: 'confirmado' }];
    app('/pasaporte');
    await tick(10);
    const card = await find(() => screen.getByRole('article', { name: 'Premio entregado' }));
    expect(within(card).getByText('¡Premio entregado!')).toBeInTheDocument();
    expect(within(card).getByText('Tu premio Nintendo Switch OLED fue entregado correctamente.')).toBeInTheDocument();
    expect(within(card).getByText('GAN-000123')).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/Pendiente de entrega|reclamar/);
    expect(popup()).toBeNull();
  });

  test('cuando el operador confirma, la tarjeta pasa de pendiente a entregado sin recargar', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    expect(screen.getByRole('article', { name: 'Premio pendiente de entrega' })).toBeInTheDocument();
    db.rows = [{ ...A, status: 'confirmado' }];
    await tick(25_000);
    expect(await find(() => screen.getByRole('article', { name: 'Premio entregado' }))).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Premio pendiente de entrega' })).toBeNull();
  });

  test('si el resultado se confirma con el aviso abierto, el aviso se retira solo', async () => {
    db.rows = [A];
    app('/ruta');
    await tick(10);
    expect(popup()).not.toBeNull();
    db.rows = [{ ...A, status: 'confirmado' }];
    await tick(25_000);
    expect(popup()).toBeNull();
  });

  test.each(['no_presentado', 'invalidado'])('%s: deja de ser un premio reclamable (ni aviso ni tarjeta de premio)', async (state) => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    expect(popup()).not.toBeNull();
    db.rows = [{ ...A, status: state }];
    await tick(25_000);
    expect(popup()).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText(/GAN-000123/)).toBeNull();
  });
});

describe('identidad', () => {
  test('dos alumnos con el mismo nombre: solo quien fue seleccionado ve el aviso', async () => {
    db.rows = [A]; // la persona A ganó; B se llama igual
    db.me = 'B';
    app('/pasaporte');
    await tick(100);
    expect(popup()).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText(/GAN-000123/)).toBeNull();
  });

  test('el premio y el folio mostrados son los del resultado de esa persona, no los de otra con el mismo nombre', async () => {
    db.rows = [A, B];
    db.me = 'B';
    app('/ruta');
    await tick(10);
    const dialog = await find(() => screen.getByRole('alertdialog'));
    expect(within(dialog).getByText('GAN-000124')).toBeInTheDocument();
    expect(within(dialog).getByText('Tarjeta de regalo Amazon')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('GAN-000123');
    expect(dialog).not.toHaveTextContent('Nintendo');
  });

  test('en el mismo dispositivo, lo que cerró una persona no esconde el aviso de otra', async () => {
    db.rows = [A, B];
    const first = app('/ruta');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    first.unmount();
    db.me = 'B'; // otra cuenta inicia sesión en el mismo teléfono
    app('/ruta');
    await tick(10);
    expect(await find(() => screen.getByText('GAN-000124'))).toBeInTheDocument();
  });

  test('la pantalla no decide qué mostrar: un resultado mal formado del servidor no se pinta', async () => {
    vi.mocked(rpc).mockResolvedValue([{ winner_id: 'x', folio: 'inventado', status: 'seleccionado', prize_name: 'Premio falso' }] as never);
    app('/ruta');
    await tick(10);
    expect(popup()).toBeNull();
  });
});

describe('conexión y arquitectura', () => {
  test('sin conexión no se rompe nada y conserva lo último que supo; al recuperarla se pone al día', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    db.offline = true;
    await tick(120_000);
    // sigue a la vista aunque no pueda consultar, pero ya no como reclamable: Supabase no lo ha confirmado
    expect(screen.getByRole('article', { name: 'Premio sin verificar' })).toHaveTextContent('GAN-000123');
    db.offline = false;
    db.rows = [{ ...A, status: 'confirmado' }];
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(10); });
    expect(await find(() => screen.getByRole('article', { name: 'Premio entregado' }))).toBeInTheDocument();
  });

  test('si estaba sin conexión cuando le tocó ganar, el aviso llega al volver', async () => {
    db.offline = true;
    db.rows = [A];
    app('/ruta');
    await tick(60_000);
    expect(popup()).toBeNull();
    db.offline = false;
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(10); });
    expect(popup()).not.toBeNull();
  });

  test('solo lee: consultar o cerrar el aviso nunca escribe nada, y no depende de Realtime', async () => {
    db.rows = [A];
    app('/ruta');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    await tick(60_000);
    expect(new Set(db.calls)).toEqual(new Set(['my_raffle_prizes']));
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe('diaov:raffle-winner-seen:v1'); // solo ids de avisos cerrados; ningún resultado se guarda
    expect(db.rows[0].status).toBe('seleccionado'); // ver el aviso no cambia el estado del premio
  });

  test('nunca hay dos consultas a la vez', async () => {
    let active = 0; let peak = 0;
    vi.mocked(rpc).mockImplementation((async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 500)); active -= 1; return { prizes: [], poll_seconds: 20 }; }) as never);
    app('/ruta');
    await act(async () => {
      for (let n = 0; n < 5; n += 1) window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(peak).toBe(1);
  });

  test('sin el proveedor la Bitácora sigue mostrando su mensaje de siempre', async () => {
    m.fetchMyRaffleStatus.mockResolvedValue({ ...status(), has_won: true });
    render(<MemoryRouter><PassportPage /></MemoryRouter>);
    await tick(10);
    expect(await find(() => screen.getByText('¡Ganaste un premio!'))).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ carga: nada de consultas continuas mientras se explora

describe('cadencia que dicta el servidor', () => {
  const calls = () => db.calls.filter((name) => name === 'my_raffle_prizes').length;

  test('aun en la cadencia más lenta nunca se deja de consultar: latido de recuperación de 10 min', async () => {
    db.forcePoll = 600;
    app('/ruta');
    await tick(100);
    expect(calls()).toBe(1);
    await tick(31 * 60_000);
    expect(calls()).toBeGreaterThanOrEqual(3);
    expect(calls()).toBeLessThanOrEqual(5);
  });

  test('aun sin ningún evento (sin foco, sin visibilidad), el aviso llega con el latido de recuperación', async () => {
    db.forcePoll = 600;
    app('/ruta');
    await tick(100);
    db.rows = [A];
    await tick(5 * 60_000);
    expect(popup()).toBeNull(); // todavía no tocaba preguntar
    await tick(7 * 60_000); // ≤ 600 s + 15 %
    expect(popup()).not.toBeNull();
  });

  test('aun sin consulta periódica reciente, volver a la pestaña o desbloquear el teléfono consulta y el aviso llega', async () => {
    db.forcePoll = 600;
    app('/ruta');
    await tick(100);
    db.rows = [A];
    await tick(60_000);
    expect(popup()).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10); });
    expect(popup()).not.toBeNull();
  });

  test('un latido lento (300 s) mientras la persona ya participa, no cada 20 s', async () => {
    db.forcePoll = 300;
    app('/ruta');
    await tick(100);
    await tick(4 * 60_000);
    expect(calls()).toBe(1);
    await tick(2 * 60_000);
    expect(calls()).toBe(2);
  });

  test('con el sorteo en curso el servidor pide ~20 s; con un resultado pendiente ~15 s', async () => {
    db.forcePoll = 20;
    app('/ruta');
    await tick(100);
    await tick(5 * 60_000);
    expect(calls()).toBeGreaterThanOrEqual(11);
    expect(calls()).toBeLessThanOrEqual(18);
  });

  test('la cadencia se adapta a lo que contesta el servidor, sin recargar', async () => {
    db.forcePoll = 300;
    app('/ruta');
    await tick(100);
    db.forcePoll = 15; // empezó el sorteo
    await tick(6 * 60_000); // el siguiente latido lo descubre
    const before = calls();
    await tick(2 * 60_000);
    expect(calls() - before).toBeGreaterThanOrEqual(6);
  });

  test('con la pestaña oculta no se consulta aunque corra el reloj', async () => {
    db.forcePoll = 20;
    app('/ruta');
    await tick(100);
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const before = calls();
    await tick(10 * 60_000);
    expect(calls()).toBe(before);
    visible.mockRestore();
  });

  test('una ráfaga de eventos (foco, visibilidad) no se convierte en una ráfaga de consultas', async () => {
    db.forcePoll = 600;
    app('/ruta');
    await tick(100);
    await act(async () => {
      for (let n = 0; n < 6; n += 1) { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(calls()).toBe(1); // dentro de los 10 s mínimos entre consultas
    await tick(12_000);
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10); });
    expect(calls()).toBe(2);
  });
});

// ------------------------------------------------------------------ Supabase manda: un resultado viejo no se presenta como reclamable

describe('resultado sin verificar', () => {
  const claimLine = /Presenta esta pantalla para reclamar tu premio/;

  test('si la última consulta falló, la tarjeta deja de presentarse como reclamable (pero no desaparece)', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    expect(screen.getByText(claimLine)).toBeInTheDocument();
    db.offline = true;
    await tick(40_000);
    const card = screen.getByRole('article', { name: 'Premio sin verificar' });
    expect(card).not.toHaveTextContent(claimLine);
    expect(card).toHaveTextContent('Por verificar');
    expect(card).toHaveTextContent('GAN-000123'); // la información sigue a la vista, solo no como reclamable
    expect(screen.queryByRole('article', { name: 'Premio pendiente de entrega' })).toBeNull();
  });

  test('«Verificar ahora» consulta y, si Supabase responde, vuelve a ser reclamable', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    db.offline = true;
    await tick(40_000);
    db.offline = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verificar ahora' })); await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole('article', { name: 'Premio pendiente de entrega' })).toHaveTextContent(claimLine);
  });

  test('el estado local desactualizado no gana: si Supabase ya lo entregó o lo retiró, eso es lo que se ve al reconectar', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    db.offline = true;
    await tick(40_000);
    db.rows = [{ ...A, status: 'no_presentado' }]; // mientras estaba sin conexión
    db.offline = false;
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(10); });
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText(claimLine)).toBeNull();
  });

  test('si pasa demasiado tiempo sin poder confirmar (consulta colgada), tampoco es reclamable', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    vi.mocked(rpc).mockImplementation((() => new Promise(() => undefined)) as never); // las siguientes lecturas nunca responden
    await tick(30_000);
    expect(screen.getByRole('article', { name: 'Premio pendiente de entrega' })).toBeInTheDocument(); // aún reciente
    await tick(40_000);
    expect(screen.getByRole('article', { name: 'Premio sin verificar' })).not.toHaveTextContent(claimLine);
  });

  test('al volver a la pantalla tras un rato, lo mostrado no vale hasta que el servidor lo confirma', async () => {
    db.rows = [A];
    app('/pasaporte');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = vi.mocked(rpc).getMockImplementation()!;
    vi.mocked(rpc).mockImplementation((async (name: string) => { await gate; return (base as (n: string) => Promise<unknown>)(name); }) as never);
    await tick(50_000);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick(60_000);
    hidden.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(5); });
    expect(screen.getByRole('article', { name: 'Premio sin verificar' })).not.toHaveTextContent(claimLine); // la consulta sigue en vuelo
    db.rows = [{ ...A, status: 'confirmado' }];
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole('article', { name: 'Premio entregado' })).toBeInTheDocument();
    hidden.mockRestore();
  });

  test('el aviso no se muestra (ni se da por visto) si la consulta no está verificada, y vuelve cuando sí lo está', async () => {
    db.rows = [A];
    app('/ruta');
    await tick(10);
    expect(popup()).not.toBeNull();
    db.offline = true;
    await tick(40_000);
    expect(popup()).toBeNull();
    expect(window.localStorage.getItem('diaov:raffle-winner-seen:v1')).toBeNull(); // no se marcó como visto
    db.offline = false;
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(10); });
    expect(popup()).not.toBeNull();
  });

  test('ningún resultado se guarda en el dispositivo: solo ids de avisos ya cerrados', async () => {
    db.rows = [A];
    app('/ruta');
    await tick(10);
    fireEvent.click(await find(() => screen.getByRole('button', { name: 'Cerrar' })));
    const stored = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(stored).not.toMatch(/GAN-|Nintendo|seleccionado|Valeria/);
  });
});

// ------------------------------------------------------------------ accesibilidad del aviso

describe('accesibilidad del aviso', () => {
  const mountInRoot = (start = '/ruta') => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="root"></div>');
    const root = document.getElementById('root')!;
    const container = root.appendChild(document.createElement('div'));
    const view = render(
      <MemoryRouter initialEntries={[start]}>
        <RafflePrizeProvider>
          <button type="button">Menú detrás</button>
          <WinnerNotice />
          <Routes><Route path="*" element={<p>Pantalla</p>} /></Routes>
        </RafflePrizeProvider>
      </MemoryRouter>,
      { container },
    );
    return { root, view };
  };
  afterEach(() => { document.getElementById('root')?.remove(); });

  test('el foco entra al aviso y Tab / Shift+Tab giran dentro de él', async () => {
    db.rows = [A];
    mountInRoot();
    await tick(10);
    const primary = screen.getByRole('button', { name: 'Ver mi premio' });
    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(primary).toHaveFocus();
    fireEvent.keyDown(primary, { key: 'Tab' });
    // el giro lo hace el aviso: simulamos el Tab del navegador desde el último elemento
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(primary).toHaveFocus();
    fireEvent.keyDown(primary, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  test('si el foco intenta salir al fondo, regresa al aviso', async () => {
    db.rows = [A];
    mountInRoot();
    await tick(10);
    const behind = screen.getByRole('button', { name: 'Menú detrás', hidden: true });
    act(() => { behind.focus(); });
    expect(screen.getByRole('button', { name: 'Ver mi premio' })).toHaveFocus();
  });

  test('el resto de la aplicación queda inerte y oculto a lectores de pantalla mientras está abierto, y se restituye al cerrar', async () => {
    db.rows = [A];
    const { root } = mountInRoot();
    expect(root).not.toHaveAttribute('inert');
    await tick(10);
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    const dialog = screen.getByRole('alertdialog');
    expect(root.contains(dialog)).toBe(false); // vive fuera de la raíz inerte
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/Felicidades, eres ganador/);
    expect(dialog).toHaveAccessibleDescription(/Has ganado un premio/);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
  });

  test('al cerrar, el foco regresa a donde estaba la persona', async () => {
    mountInRoot();
    await tick(10);
    const menu = screen.getByRole('button', { name: 'Menú detrás' });
    menu.focus();
    db.rows = [A];
    await tick(25_000); // llega el aviso estando en el menú
    expect(screen.getByRole('button', { name: 'Ver mi premio' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(menu).toHaveFocus();
  });

  test('Escape lo cierra, lo da por visto y devuelve el foco', async () => {
    mountInRoot();
    await tick(10);
    const menu = screen.getByRole('button', { name: 'Menú detrás' });
    menu.focus();
    db.rows = [A];
    await tick(25_000);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(popup()).toBeNull();
    expect(menu).toHaveFocus();
    await tick(60_000);
    expect(popup()).toBeNull(); // no vuelve
  });

  test('si el aviso se retira porque el premio ya se entregó, también se libera el fondo', async () => {
    db.rows = [A];
    const { root } = mountInRoot();
    await tick(10);
    expect(root).toHaveAttribute('inert');
    db.rows = [{ ...A, status: 'confirmado' }];
    await tick(25_000);
    expect(popup()).toBeNull();
    expect(root).not.toHaveAttribute('inert');
  });
});

// ------------------------------------------------------------------ transiciones de cadencia con las reglas del servidor

describe('transiciones de cadencia (reglas del servidor, sin atajos)', () => {
  const calls = () => db.calls.filter((name) => name === 'my_raffle_prizes').length;
  /** Consultas hechas en una ventana de tiempo. */
  const within = async (ms: number) => { const before = calls(); await tick(ms); return calls() - before; };
  const OTHER: Row = { id: 'w-x', participant: 'C', folio: 'GAN-000050', status: 'confirmado', prize: 'Audífonos', category: 'Galaxia', name: 'Otra Persona' };
  const announce = (kind: string) => act(async () => { m.listeners.forEach((listener) => listener(kind)); await vi.advanceTimersByTimeAsync(10); });

  beforeEach(() => { db.forcePoll = undefined; });

  test('sin asistencias el latido es de 10 min; al llegar la primera, la cadencia baja a 3 min (sin depender de eventos)', async () => {
    db.attended = false; db.eligible = false;
    app('/ruta');
    await tick(100);
    expect(await within(25 * 60_000)).toBeLessThanOrEqual(4); // latido de recuperación: ~1 cada 10 min
    db.attended = true; db.eligible = true; // registró asistencias y entró a una categoría (la app siguió abierta)
    await tick(11.6 * 60_000); // a lo sumo un latido después la plataforma ya lo sabe…
    const since = await within(10 * 60_000);
    expect(since).toBeGreaterThanOrEqual(3); // …y desde entonces consulta cada ~3 min (180 s), no cada 10
  });

  test('si lo registra en esta pestaña o en otra, no espera al latido: la cadencia cambia al momento', async () => {
    db.attended = false; db.eligible = false;
    app('/ruta');
    await tick(100);
    db.attended = true; db.eligible = true;
    const before = calls();
    await announce('attendance'); // otra pestaña registró la asistencia
    expect(calls()).toBe(before + 1);
    expect(await within(10 * 60_000)).toBeGreaterThanOrEqual(3); // ya en la cadencia de 180 s
  });

  test('un anuncio que no es de asistencia (reservaciones) no provoca consultas', async () => {
    app('/ruta');
    await tick(100);
    const before = calls();
    await announce('reservation');
    expect(calls()).toBe(before);
  });

  test('primera selección del sorteo: quien estaba en el latido de 3 min pasa a ~20 s en su siguiente consulta, y desde entonces se entera en ~20 s', async () => {
    app('/ruta');
    await tick(100);
    expect(await within(5 * 60_000)).toBeLessThanOrEqual(3); // idle: ~1 cada 3 min
    db.rows = [OTHER]; // empieza el sorteo: aparece el primer ganador (otra persona)
    await tick(3.6 * 60_000); // como mucho, un latido (180 s + 15 %) después esta persona lo descubre
    expect(await within(2 * 60_000)).toBeGreaterThanOrEqual(5); // ya consulta cada ~20 s
    db.rows = [OTHER, A]; // ahora le toca a ella
    await tick(24_000); // ≤ 20 s + 15 %
    expect(popup()).not.toBeNull();
  });

  test('latencia máxima del PRIMER aviso estando en reposo: un latido de 3 min (≤ 207 s); nunca más', async () => {
    app('/ruta');
    await tick(100);
    await tick(60_000);
    db.rows = [A]; // la seleccionan justo después de su última consulta
    await tick(100_000);
    expect(popup()).toBeNull(); // el latido más corto posible es 153 s
    await tick(110_000); // 100 + 110 = 210 s > 207 s
    expect(popup()).not.toBeNull();
  });

  test('persona sin categoría: latido de 5 min; con el sorteo en curso, 2 min (su premio no depende de ella)', async () => {
    db.eligible = false;
    app('/ruta');
    await tick(100);
    expect(await within(31 * 60_000)).toBeLessThanOrEqual(7);
    db.rows = [OTHER];
    await tick(6 * 60_000);
    const live = await within(10 * 60_000);
    expect(live).toBeGreaterThanOrEqual(4);
    expect(live).toBeLessThanOrEqual(7);
  });

  test('nunca queda sin temporizador: tras 12 horas, con fallos y pestaña oculta de por medio, sigue consultando', async () => {
    db.attended = false; db.eligible = false;
    app('/ruta');
    await tick(100);
    db.offline = true;
    await tick(30 * 60_000); // fallos: los reintentos se espacian pero continúan
    db.offline = false;
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick(2 * 3600_000); // oculta: no consulta, pero la cadena sigue armada
    hidden.mockReturnValue('visible'); // vuelve sin que llegue ningún evento
    const before = calls();
    await tick(12 * 60_000);
    expect(calls()).toBeGreaterThan(before);
    hidden.mockRestore();
    const total = calls();
    await tick(9 * 3600_000);
    expect(calls() - total).toBeGreaterThanOrEqual(40); // ~1 cada 10 min durante 9 h
  });

  test('en reposo la carga es baja: 2,000 alumnos ≈ 11 consultas/s como máximo (antes ≈ 100/s)', async () => {
    // Un alumno en la cadencia más frecuente de reposo (en categoría, 180 s) hace ≈ 1 consulta cada 3 min.
    app('/ruta');
    await tick(100);
    const perMinute = (await within(30 * 60_000)) / 30;
    expect(perMinute).toBeLessThanOrEqual(0.4); // ≈ 0.33/min
    expect((2000 * perMinute) / 60).toBeLessThanOrEqual(11.5);
  });
});
