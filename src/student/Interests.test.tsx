import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { neutralTheme } from '../theme/neutralTheme';
import Interests from './Interests';

const m = vi.hoisted(() => ({ fetchDivisions: vi.fn(), fetchInterests: vi.fn(), rpc: vi.fn() }));

vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchDivisions: m.fetchDivisions,
  fetchPostEventInterests: m.fetchInterests,
}));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: m.rpc } }));
vi.mock('./ExitSurveyProvider', () => ({
  useExitSurvey: () => ({ enabled: true, status: { isOpen: true, completed: false } }),
}));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
  }),
}));

const openInterests = (careerIds: string[] = []) => ({
  post_event_interests_prompt: true,
  post_event_interests_open: true,
  post_event_interests_completed: careerIds.length > 0,
  post_event_interests_can_edit: true,
  max_interests: 3,
  career_ids: careerIds,
  items: careerIds.map((career_id, index) => ({ career_id, preference: index + 1 })),
  careers: [
    { id: 'initial', code: 'MED', name: 'Medicina', division_id: 'health' },
    { id: 'other', code: 'NEG', name: 'Negocios Internacionales', division_id: 'business' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.fetchDivisions.mockResolvedValue([
    { id: 'health', code: 'SALUD', name: 'Salud', sort_order: 1, is_demo: false },
    { id: 'business', code: 'NEGOCIOS', name: 'Negocios', sort_order: 2, is_demo: false },
  ]);
  m.fetchInterests.mockResolvedValue(openInterests());
  m.rpc.mockResolvedValue({ error: null });
});

const show = () => render(<MemoryRouter><Interests /></MemoryRouter>);

test('explica que es una reflexión posterior y que no cambia el prerregistro', async () => {
  show();
  expect(await screen.findByRole('heading', { name: /Después de todo lo que descubriste hoy/ })).toBeInTheDocument();
  expect(screen.getByText('Tu prerregistro permanece igual.')).toBeInTheDocument();
  expect(screen.getByText(/Tu carrera inicial también puede estar entre estas opciones/)).toBeInTheDocument();
});

test('una selección vacía sigue pendiente y nunca se guarda como respuesta', async () => {
  show();
  expect(await screen.findByText(/Todavía no has respondido/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Guardar mis intereses' })).toBeDisabled();
  expect(screen.getByText(/No guardaremos una selección vacía/)).toBeInTheDocument();
  expect(m.rpc).not.toHaveBeenCalled();
});

test('permite conservar la carrera inicial, sumar otras y guarda el orden elegido', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Medicina' }));
  fireEvent.click(screen.getByRole('button', { name: 'Negocios Internacionales' }));
  fireEvent.click(screen.getByRole('button', { name: 'Subir Negocios Internacionales' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar mis intereses' }));
  await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('save_post_event_interests', {
    p_career_ids: ['other', 'initial'],
  }));
  expect(await screen.findByText('Gracias. Guardamos tus intereses posteriores al evento.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Responder encuesta/ })).toHaveAttribute('href', '/encuesta');
});

test('una respuesta guardada puede retirarse por completo sin dejar una selección vacía como completada', async () => {
  m.fetchInterests.mockResolvedValue(openInterests(['initial']));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Quitar Medicina' }));
  expect(screen.getByRole('button', { name: 'Retirar todas mis elecciones' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retirar todas mis elecciones' }));
  await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('save_post_event_interests', { p_career_ids: [] }));
  expect(await screen.findByText(/Esta etapa vuelve a quedar pendiente/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Responder encuesta/ })).not.toBeInTheDocument();
  expect(screen.getByText(/No guardaremos una selección vacía/)).toBeInTheDocument();
});

test('un fallo de Supabase conserva el estado pendiente y nunca muestra éxito', async () => {
  m.rpc.mockResolvedValue({ error: new Error('NETWORK') });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Medicina' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar mis intereses' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent(/Guardamos|Retiramos/);
  expect(screen.queryByRole('link', { name: /Responder encuesta/ })).not.toBeInTheDocument();
});

test('antes de habilitarse no presenta una selección ni permite guardar', async () => {
  m.fetchInterests.mockResolvedValue({ ...openInterests(), post_event_interests_prompt: false, post_event_interests_can_edit: false });
  show();
  expect(await screen.findByText(/se habilita después de participar/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar mis intereses' })).not.toBeInTheDocument();
});
