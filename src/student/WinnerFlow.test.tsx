import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from '../lib/adminApi';
import { resetSeenMemory } from '../lib/raffleWinner';
import { neutralTheme } from '../theme/neutralTheme';
import PassportPage from './PassportPage';
import { RafflePrizeProvider } from './RafflePrizeProvider';
import WinnerNotice from './WinnerNotice';

const m = vi.hoisted(() => ({ fetchProgress: vi.fn(), fetchDivisions: vi.fn(), fetchMyRaffleStatus: vi.fn() }));
vi.mock('../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../lib/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/catalog')>()), fetchProgress: m.fetchProgress, fetchDivisions: m.fetchDivisions }));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.fetchMyRaffleStatus }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Valeria Méndez Castillo' }, signOut: vi.fn() }) }));
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
const db = { rows: [] as Row[], me: 'A', offline: false, calls: [] as string[], poll: 20 as number | null };
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
  db.rows = []; db.me = 'A'; db.offline = false; db.calls = []; db.poll = 20;
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
    return { prizes, poll_seconds: db.poll };
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

  test('«no consultes» (explorando y reservando): una lectura al abrir y ninguna periódica en media hora', async () => {
    db.poll = null;
    app('/ruta');
    await tick(100);
    expect(calls()).toBe(1);
    await tick(30 * 60_000);
    expect(calls()).toBe(1);
  });

  test('aun sin consulta periódica, volver a la pestaña o desbloquear el teléfono consulta (y un aviso llega)', async () => {
    db.poll = null;
    app('/ruta');
    await tick(100);
    db.rows = [A];
    await tick(60_000);
    expect(popup()).toBeNull(); // nadie preguntó todavía
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10); });
    expect(popup()).not.toBeNull();
  });

  test('un latido lento (300 s) mientras la persona ya participa, no cada 20 s', async () => {
    db.poll = 300;
    app('/ruta');
    await tick(100);
    await tick(4 * 60_000);
    expect(calls()).toBe(1);
    await tick(2 * 60_000);
    expect(calls()).toBe(2);
  });

  test('con el sorteo en curso el servidor pide ~20 s; con un resultado pendiente ~15 s', async () => {
    db.poll = 20;
    app('/ruta');
    await tick(100);
    await tick(5 * 60_000);
    expect(calls()).toBeGreaterThanOrEqual(11);
    expect(calls()).toBeLessThanOrEqual(18);
  });

  test('la cadencia se adapta a lo que contesta el servidor, sin recargar', async () => {
    db.poll = 300;
    app('/ruta');
    await tick(100);
    db.poll = 15; // empezó el sorteo
    await tick(6 * 60_000); // el siguiente latido lo descubre
    const before = calls();
    await tick(2 * 60_000);
    expect(calls() - before).toBeGreaterThanOrEqual(6);
  });

  test('con la pestaña oculta no se consulta aunque corra el reloj', async () => {
    db.poll = 20;
    app('/ruta');
    await tick(100);
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const before = calls();
    await tick(10 * 60_000);
    expect(calls()).toBe(before);
    visible.mockRestore();
  });

  test('una ráfaga de eventos (foco, visibilidad) no se convierte en una ráfaga de consultas', async () => {
    db.poll = null;
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
