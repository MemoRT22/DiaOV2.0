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
const db = { rows: [] as Row[], me: 'A', offline: false, calls: [] as string[] };
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
  db.rows = []; db.me = 'A'; db.offline = false; db.calls = [];
  m.fetchProgress.mockResolvedValue(progress());
  m.fetchDivisions.mockResolvedValue([]);
  m.fetchMyRaffleStatus.mockImplementation(async () => status());
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    db.calls.push(name);
    if (db.offline) throw new TypeError('Failed to fetch');
    if (name !== 'my_raffle_prizes') throw new Error(`rpc inesperada ${name}`);
    return db.rows.filter((r) => r.participant === db.me && ['seleccionado', 'confirmado'].includes(r.status)).map((r) => ({
      winner_id: r.id, folio: r.folio, status: r.status, prize_name: r.prize, category_name: r.category, display_name: r.name, drawn_at: '2026-10-22T16:00:00Z', confirmed_at: r.status === 'confirmado' ? '2026-10-22T16:05:00Z' : null,
    }));
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
    expect(screen.getByRole('article', { name: 'Premio pendiente de entrega' })).toBeInTheDocument(); // sigue visible aunque no pueda consultar
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
    expect(db.rows[0].status).toBe('seleccionado'); // ver el aviso no cambia el estado del premio
  });

  test('nunca hay dos consultas a la vez', async () => {
    let active = 0; let peak = 0;
    vi.mocked(rpc).mockImplementation((async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 500)); active -= 1; return []; }) as never);
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
