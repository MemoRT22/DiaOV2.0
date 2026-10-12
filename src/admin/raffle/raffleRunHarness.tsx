/** Shared by the console tests: mocked server calls, fixtures and small helpers. The mocks themselves live in each test file (vi.mock is per file). */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { OFFICIAL, prize } from './raffleFixtures';

export const drawn = (name = 'Ana López', over: Record<string, unknown> = {}) => ({
  winner_id: 'w1', participant_id: 'p1', display_name: name, prize_id: 'tablet', prize_name: 'Tablet', category_id: 'un', category_name: 'Universo',
  status: 'seleccionado', pool_size: 4, idempotent: false, ...over,
});

export const defaultPrizes = () => ({
  un: [prize('tablet', 'un', 'Tablet', 3, 2), prize('audifonos', 'un', 'Audífonos', 1, 0)],
  ga: [prize('bocina', 'ga', 'Bocina', 5, 5)],
  ss: [] as ReturnType<typeof prize>[],
});

export const setReducedMotion = () => {
  const real = window.matchMedia;
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = real; };
};

export const openConsole = (Component: typeof RaffleAdmin = RaffleAdmin) =>
  render(<MemoryRouter initialEntries={['/?seccion=ejecutar']}><Component /></MemoryRouter>);

/** The operator's stage (the public screen and the rehearsal have a stage too; this is the one with the controls). */
const consoleElement = () => document.querySelector('.rf-run .rf-stage') as HTMLElement;
export const stage = () => within(consoleElement());
export const consoleStage = stage;

export async function ready(name: RegExp | string = 'Sortear') {
  await waitFor(() => expect(consoleElement()).not.toBeNull());
  return within(consoleElement()).findByRole('button', { name });
}
export async function readyToDraw() {
  const button = await ready('Sortear');
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}
export const view = (categories = OFFICIAL) => structuredClone({ categories, unassigned_combinations: [] });
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
export { fireEvent, screen, waitFor, within, vi };
