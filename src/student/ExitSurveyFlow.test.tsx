import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from '../lib/adminApi';
import { useAuth } from '../lib/auth';
import ExitSurveyCard from './ExitSurveyCard';
import ExitSurveyInvite from './ExitSurveyInvite';
import ExitSurveyPage from './ExitSurveyPage';
import { ExitSurveyProvider } from './ExitSurveyProvider';
import RaffleStatusCard from './RaffleStatusCard';
import { normalizeRaffleStatus } from '../lib/raffleRules';

vi.mock('../lib/adminApi', () => ({ rpc: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));

const OPENS = '2026-10-15T18:00:00Z'; // 13:00 en Cancún
type Server = { now: string; opensAt: string; completed: boolean; invitedAt: string | null; stampsMet: boolean };
let server: Server;
let submitImpl: (payload: Record<string, unknown>) => Promise<unknown>;

const isOpen = () => Date.parse(server.now) >= Date.parse(server.opensAt);
const view = (extra: Record<string, unknown> = {}) => ({
  version: 'exit-2026-v1', opens_at: server.opensAt, server_now: server.now, is_open: isOpen(), completed: server.completed,
  completed_at: server.completed ? server.now : null, invited_at: server.invitedAt, has_won: false,
  stamps_category_id: server.stampsMet ? 'cat' : null, stamps_category_name: server.stampsMet ? 'Galaxia' : null,
  stamps_met: server.stampsMet, eligible: server.completed && server.stampsMet, ...extra,
});

/** Un «servidor» mínimo: la hora la manda él, no el navegador. */
function mockServer() {
  vi.mocked(rpc).mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'my_exit_survey') return view();
    if (name === 'exit_survey_mark_invited') { if (isOpen()) server.invitedAt ??= server.now; return view(); }
    if (name === 'submit_exit_survey') return submitImpl((args as { p: Record<string, unknown> }).p);
    throw new Error(`rpc inesperado ${name}`);
  });
}
const saveOk = async () => { server.completed = true; return view({ saved: true, already_completed: false }); };

function Go({ to, label }: { to: string; label: string }) { const navigate = useNavigate(); return <button onClick={() => navigate(to)}>{label}</button>; }
const app = (path = '/bitacora') => render(
  <MemoryRouter initialEntries={[path]}>
    <ExitSurveyProvider>
      <Routes>
        <Route path="/bitacora" element={<div><p>Inicio</p><Go to="/escanear" label="ir-escanear" /><Go to="/pasaporte" label="ir-pasaporte" /></div>} />
        <Route path="/escanear" element={<div><p>Escáner</p><Go to="/bitacora" label="salir-escaner" /></div>} />
        <Route path="/pasaporte" element={<ExitSurveyCard />} />
        <Route path="/encuesta" element={<ExitSurveyPage />} />
      </Routes>
      <ExitSurveyInvite />
    </ExitSurveyProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(useAuth).mockReturnValue({ profile: { participant_id: 'p-1', display_name: 'Ana' } } as unknown as ReturnType<typeof useAuth>);
  server = { now: '2026-10-15T17:00:00Z', opensAt: OPENS, completed: false, invitedAt: null, stampsMet: true };
  submitImpl = saveOk;
  mockServer();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const popup = () => screen.queryByRole('alertdialog');

async function answerAll() {
  fireEvent.click(screen.getByLabelText('Estaba entre varias opciones')); fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(await screen.findByLabelText('4 de 5 estrellas')); fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(await screen.findByLabelText('Tengo algunas opciones')); fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(await screen.findByLabelText('Salud')); fireEvent.click(screen.getByLabelText('Ingenierías')); fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(await screen.findByLabelText('9')); 
}
const send = () => fireEvent.click(screen.getByRole('button', { name: /Enviar encuesta|Reintentar envío/ }));

describe('popup de invitación', () => {
  test('6: a la hora configurada (la dicta el servidor) aparece el popup con el mensaje del requisito, y se puede posponer', async () => {
    fake(); vi.spyOn(Math, 'random').mockReturnValue(0);
    server.now = '2026-10-15T17:59:30Z'; // faltan 30 s
    app();
    await tick(10);
    expect(popup()).toBeNull(); // todavía no es la hora
    server.now = '2026-10-15T18:00:01Z';
    await tick(31_000); // el temporizador solo despierta la consulta; el servidor decide
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Una última misión')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('requisito adicional para participar en el sorteo');
    expect(within(dialog).getByRole('button', { name: 'Responder encuesta' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ahora no' }));
    expect(popup()).toBeNull();
    await tick(120_000);
    expect(popup()).toBeNull(); // no insiste
    expect(vi.mocked(rpc).mock.calls.filter(([name]) => name === 'exit_survey_mark_invited')).toHaveLength(1);
  });

  test('un reloj del dispositivo adelantado no abre nada: manda el servidor', async () => {
    fake();
    server.now = '2026-10-15T12:00:00Z';
    vi.setSystemTime(new Date('2026-10-15T19:30:00Z')); // el dispositivo cree que ya pasó la hora
    app();
    await tick(50);
    expect(popup()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Responder encuesta' })).toBeNull();
  });

  test('7: quien abre la aplicación después de la hora la encuentra disponible de inmediato', async () => {
    server.now = '2026-10-15T19:40:00Z';
    app();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Una última misión');
  });

  test('regresar a la pestaña o recuperar la conexión también reconoce que ya abrió', async () => {
    server.now = '2026-10-15T17:00:00Z';
    app();
    await waitFor(() => expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'my_exit_survey')).toBe(true));
    expect(popup()).toBeNull();
    server.now = '2026-10-15T18:10:00Z';
    // volver a la pestaña después de un rato (pasó el mínimo entre consultas)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  test('una sola vez por alumno: si el servidor ya lo invitó (otro dispositivo), no vuelve a salir; tampoco si ya contestó', async () => {
    server.now = '2026-10-15T19:00:00Z'; server.invitedAt = '2026-10-15T18:30:00Z';
    app();
    await waitFor(() => expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'my_exit_survey')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(popup()).toBeNull();
  });
  test('quien ya contestó no recibe la invitación', async () => {
    server.now = '2026-10-15T19:00:00Z'; server.completed = true;
    app();
    await waitFor(() => expect(vi.mocked(rpc).mock.calls.some(([name]) => name === 'my_exit_survey')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(popup()).toBeNull();
  });

  test('no interrumpe el escaneo de un QR: espera a que salga del escáner, se asienta unos segundos y entonces invita', async () => {
    fake();
    server.now = '2026-10-15T19:00:00Z';
    app('/escanear');
    await tick(50);
    expect(popup()).toBeNull();
    await tick(60_000);
    expect(popup()).toBeNull(); // sigue escaneando: ni un minuto después
    fireEvent.click(screen.getByRole('button', { name: 'salir-escaner' }));
    await tick(500);
    expect(popup()).toBeNull(); // no se cruza con el momento en que salió
    await tick(3000);
    expect(popup()).not.toBeNull();
  });

  test('en una confirmación abierta no sale; al cerrarla (y tras asentarse) sí', async () => {
    fake();
    server.now = '2026-10-15T19:00:00Z';
    const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.appendChild(modal);
    app('/bitacora');
    await tick(100);
    expect(popup()).toBeNull();
    modal.remove();
    await tick(1000);
    expect(popup()).toBeNull();
    await tick(3000);
    expect(popup()).not.toBeNull();
  });

  test('«Responder encuesta» lleva a la encuesta y no se vuelve a invitar estando en ella', async () => {
    server.now = '2026-10-15T19:00:00Z';
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Responder encuesta' }));
    expect(await screen.findByText('Pregunta 1 de 5')).toBeInTheDocument();
    expect(popup()).toBeNull();
  });
});

describe('acceso permanente desde la Bitácora', () => {
  test('pendiente: invita a completarla; completada: agradece y no ofrece contestar de nuevo; antes de la hora: dice cuándo abre', async () => {
    server.now = '2026-10-15T17:00:00Z';
    const first = app('/pasaporte');
    expect(await screen.findByText(/Se abrirá hoy a las 1:00 p\.m\./)).toBeInTheDocument();
    first.unmount();
    server.now = '2026-10-15T19:00:00Z';
    const second = app('/pasaporte');
    expect(await screen.findByText('Completa tu encuesta para participar en el sorteo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Responder encuesta' })).toHaveAttribute('href', '/encuesta');
    second.unmount();
    server.completed = true;
    app('/pasaporte');
    expect(await screen.findByText('¡Gracias por compartir tu experiencia!')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Responder encuesta' })).toBeNull();
  });

  test('8: quien cerró el popup puede contestar desde su Bitácora, y al terminar el servidor dice que ya participa', async () => {
    server.now = '2026-10-15T19:00:00Z';
    app('/bitacora');
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(popup()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ir-pasaporte' }));
    expect(await screen.findByText('Completa tu encuesta para participar en el sorteo.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Responder encuesta' }));
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    send();
    expect(await screen.findByText('¡Misión completada!')).toBeInTheDocument();
    expect(screen.getByText(/Ya cumples los requisitos para participar en el sorteo/)).toBeInTheDocument();
    expect(server.completed).toBe(true);
    expect(popup()).toBeNull();
    expect(vi.mocked(rpc).mock.calls.filter(([name]) => name === 'submit_exit_survey')).toHaveLength(1);
  });
});

describe('encuesta: una pregunta por paso', () => {
  test('cinco pasos, avance claro, «Siguiente» solo con la pregunta contestada, comentario opcional y mensaje final del servidor', async () => {
    server.now = '2026-10-15T19:00:00Z';
    const payloads: Record<string, unknown>[] = [];
    submitImpl = async (payload) => { payloads.push(payload); return saveOk(); };
    app('/encuesta');
    expect(await screen.findByText('Pregunta 1 de 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    const next = () => screen.getByRole('button', { name: /Siguiente/ });
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Estaba entre varias opciones'));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    fireEvent.click(next());
    expect(await screen.findByText('Pregunta 2 de 5')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('4 de 5 estrellas')); fireEvent.click(next());
    expect(await screen.findByText('Pregunta 3 de 5')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Tengo algunas opciones')); fireEvent.click(next());
    expect(await screen.findByText('Pregunta 4 de 5')).toBeInTheDocument();
    // hasta tres áreas
    for (const label of ['Salud', 'Deporte', 'Negocios']) fireEvent.click(screen.getByLabelText(label));
    expect(screen.getByLabelText('Ingenierías')).toBeDisabled();
    expect(screen.getByText('3 de 3 elegidas')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Todavía no tengo un área definida')); // exclusiva
    expect(screen.getByLabelText('Salud')).not.toBeChecked();
    expect(screen.getByLabelText('Todavía no tengo un área definida')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Todavía no tengo un área definida'));
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Salud')); fireEvent.click(next());
    expect(await screen.findByText('Pregunta 5 de 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar encuesta/ })).toBeDisabled(); // falta la recomendación
    fireEvent.click(screen.getByLabelText('0')); // 0 es una respuesta válida
    expect(screen.getByRole('button', { name: /Enviar encuesta/ })).toBeEnabled();
    expect(screen.getByLabelText(/¿Qué mejorarías\?/)).toBeInTheDocument(); // opcional: se envía sin escribirlo
    send();
    expect(await screen.findByText('¡Misión completada!')).toBeInTheDocument();
    expect(screen.getByText('Gracias por ayudarnos a mejorar el Día OV.')).toBeInTheDocument();
    expect(screen.getByText(/Ya cumples los requisitos para participar en el sorteo/)).toBeInTheDocument();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ version: 'exit-2026-v1', q1: 'entre_varias', q2: 4, q3: 'algunas_opciones', q4: ['salud'], q5: 0, comment: null });
    expect(JSON.stringify(payloads[0])).not.toMatch(/participant|p-1/); // jamás un identificador del navegador
  });

  test('si todavía le faltan sellos, el mensaje final lo dice (lo calcula el servidor)', async () => {
    server.now = '2026-10-15T19:00:00Z'; server.stampsMet = false;
    app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    send();
    expect(await screen.findByText('Tu encuesta ya está lista. Sigue completando misiones para alcanzar una categoría.')).toBeInTheDocument();
    expect(screen.queryByText(/Ya cumples los requisitos/)).toBeNull();
  });

  test('9: si se pierde la conexión al enviar, nada se pierde: aviso claro, respuestas intactas y reintento seguro', async () => {
    server.now = '2026-10-15T19:00:00Z';
    let attempts = 0;
    submitImpl = async () => { attempts += 1; if (attempts === 1) throw { message: 'TypeError: Failed to fetch' }; return saveOk(); };
    app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    fireEvent.change(screen.getByLabelText(/¿Qué mejorarías\?/), { target: { value: 'Más talleres de robótica' } });
    send();
    expect(await screen.findByText(/No hay conexión/)).toBeInTheDocument();
    expect(screen.getByText(/Tus respuestas se conservan/)).toBeInTheDocument();
    expect(screen.getByLabelText('9')).toBeChecked();
    expect((screen.getByLabelText(/¿Qué mejorarías\?/) as HTMLTextAreaElement).value).toBe('Más talleres de robótica');
    send(); // «Reintentar envío»
    expect(await screen.findByText('¡Misión completada!')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  test('si el primer envío SÍ llegó al servidor aunque no se supo, el reintento responde «ya completada» y no duplica', async () => {
    server.now = '2026-10-15T19:00:00Z';
    let attempts = 0;
    submitImpl = async () => {
      attempts += 1;
      if (attempts === 1) { server.completed = true; throw { message: 'TypeError: Failed to fetch' }; } // se guardó, pero la respuesta se perdió
      return view({ saved: false, already_completed: true });
    };
    app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    send();
    await screen.findByText(/No hay conexión/);
    send();
    expect(await screen.findByText('¡Gracias por compartir tu experiencia!')).toBeInTheDocument(); // ya estaba registrada
  });

  test('10: dos envíos seguidos (doble clic) mandan una sola solicitud', async () => {
    server.now = '2026-10-15T19:00:00Z';
    let release: () => void = () => undefined;
    const calls: unknown[] = [];
    submitImpl = (payload) => { calls.push(payload); return new Promise((resolve) => { release = () => resolve(saveOk()); }); };
    app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    const button = screen.getByRole('button', { name: /Enviar encuesta/ });
    fireEvent.click(button); fireEvent.click(button); fireEvent.submit(button.closest('form')!);
    expect(calls).toHaveLength(1);
    await act(async () => { release(); });
    expect(await screen.findByText('¡Misión completada!')).toBeInTheDocument();
  });

  test('un error del servidor (p. ej. aún cerrada) se explica y conserva lo escrito; no se marca como completada', async () => {
    server.now = '2026-10-15T19:00:00Z';
    submitImpl = async () => { throw { message: 'SURVEY_NOT_OPEN' }; };
    app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    await answerAll();
    send();
    expect(await screen.findByText(/todavía no está abierta/)).toBeInTheDocument();
    expect(screen.queryByText('¡Misión completada!')).toBeNull();
    expect(screen.getByLabelText('9')).toBeChecked();
  });

  test('lo escrito se conserva si se recarga la pestaña, y se borra al terminar', async () => {
    server.now = '2026-10-15T19:00:00Z';
    const first = app('/encuesta');
    await screen.findByText('Pregunta 1 de 5');
    fireEvent.click(screen.getByLabelText('Todavía no tenía idea'));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await screen.findByText('Pregunta 2 de 5');
    first.unmount();
    app('/encuesta');
    expect(await screen.findByText('Pregunta 2 de 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(await screen.findByLabelText('Todavía no tenía idea')).toBeChecked();
  });

  test('antes de la hora la encuesta no se puede contestar aunque se abra la dirección; ya contestada, no se vuelve a ofrecer', async () => {
    server.now = '2026-10-15T17:00:00Z';
    const early = app('/encuesta');
    expect(await screen.findByText('La encuesta aún no está abierta')).toBeInTheDocument();
    expect(screen.queryByText('Pregunta 1 de 5')).toBeNull();
    early.unmount();
    server.now = '2026-10-15T19:00:00Z'; server.completed = true;
    app('/encuesta');
    expect(await screen.findByText('¡Gracias por compartir tu experiencia!')).toBeInTheDocument();
    expect(screen.queryByText('Pregunta 1 de 5')).toBeNull();
  });
});

describe('estado del sorteo en la Bitácora', () => {
  const status = (over: Record<string, unknown>) => normalizeRaffleStatus({ academic_stamps: 1, university_life_stamps: 1, raffle_category: 'c', raffle_category_name: 'Sistema Solar', has_won: false, categories: [], ...over });
  test('con los sellos y sin encuesta: sigue mostrando su categoría y dice qué falta', () => {
    render(<MemoryRouter><RaffleStatusCard raffle={status({ survey_completed: false, raffle_eligible: false })} /></MemoryRouter>);
    expect(screen.getByText('Sistema Solar')).toBeInTheDocument();
    expect(screen.getByTestId('survey-pending')).toHaveTextContent('Ya tienes los sellos necesarios. Solo falta completar tu encuesta para participar.');
    expect(screen.queryByText('Ya participas en el sorteo.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Responder encuesta' })).toHaveAttribute('href', '/encuesta');
  });
  test('encuesta completada: participa y ya no hay aviso', () => {
    render(<MemoryRouter><RaffleStatusCard raffle={status({ survey_completed: true, raffle_eligible: true })} /></MemoryRouter>);
    expect(screen.queryByTestId('survey-pending')).toBeNull();
    expect(screen.getByText('Ya participas en el sorteo.')).toBeInTheDocument();
  });
  test('sin categoría por sellos no hay aviso de encuesta (primero faltan sellos); un servidor anterior no inventa el aviso', () => {
    const { unmount } = render(<MemoryRouter><RaffleStatusCard raffle={status({ raffle_category: null, raffle_category_name: null, survey_completed: false })} /></MemoryRouter>);
    expect(screen.queryByTestId('survey-pending')).toBeNull();
    unmount();
    render(<MemoryRouter><RaffleStatusCard raffle={status({})} /></MemoryRouter>);
    expect(screen.queryByTestId('survey-pending')).toBeNull();
  });
});
