import { render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Progress } from '../lib/catalog';
import { neutralTheme } from '../theme/neutralTheme';
import type { ThemeConfig } from '../theme/types';
import { isStampLadder, MAX_RANK_STAMPS, stampsForRank } from './progressText';
import RankProgress from './RankProgress';

// The theme of the event: five ranks, in this order.
const NAMES = ['Cadete Espacial', 'Navegante Orbital', 'Piloto Interestelar', 'Comandante de Misión', 'Explorador del Universo'];
const theme: ThemeConfig = {
  ...neutralTheme,
  vocabulary: { ...neutralTheme.vocabulary, rank: { one: 'Rango', many: 'Rangos' } },
  ranks: NAMES.map((name, i) => ({ name, description: `Descripción ${i + 1}`, promotion: '' })),
  texts: { ...neutralTheme.texts, progressMax: 'Progreso: rango máximo' },
};

vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme,
    term: (key: 'stamp' | 'division' | 'rank', plural = false) => (theme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (theme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => theme.ranks[Math.min(Math.max(level, 1), 5) - 1].name,
  }),
}));

/** What the server answers: one stamp, one rank (rank_rules_by_stamps_only). */
const progress = (stamps: number, over: Partial<Progress> = {}): Progress => {
  const level = Math.min(stamps + 1, 5);
  return {
    level, stamps, attended_workshops: stamps, reserved_workshops: 0, division_ids: [],
    next: level < 5 ? { level: level + 1, required_attendances: level, required_divisions: 0 } : null,
    consent_accepted: true, post_event_interests_prompt: false, post_event_interests_open: false, post_event_interests_completed: false,
    ...over,
  };
};
const show = (p: Progress, full = false) => render(<RankProgress progress={p} full={full} />);
const current = () => document.querySelector('h2')?.textContent;

describe('the one-stamp-per-rank ladder', () => {
  test.each([
    [0, 'Cadete Espacial', 'Navegante Orbital', 'Te falta 1 sello para llegar a Navegante Orbital.'],
    [1, 'Navegante Orbital', 'Piloto Interestelar', 'Te falta 1 sello para llegar a Piloto Interestelar.'],
    [2, 'Piloto Interestelar', 'Comandante de Misión', 'Te falta 1 sello para llegar a Comandante de Misión.'],
    [3, 'Comandante de Misión', 'Explorador del Universo', 'Te falta 1 sello para llegar a Explorador del Universo.'],
  ])('%i stamps → %s, next %s, one stamp missing', (stamps, name, _next, message) => {
    show(progress(stamps));
    expect(current()).toBe(name);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(`Rango ${stamps + 1} de 5`)).toBeInTheDocument();
    expect(screen.queryByText('Progreso: rango máximo')).not.toBeInTheDocument();
  });

  test('4 stamps → Explorador del Universo, complete, maximum-rank message and no fifth stamp asked', () => {
    show(progress(4));
    expect(current()).toBe('Explorador del Universo');
    expect(screen.getByText('Progreso: rango máximo')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '4 de 4 sellos para Explorador del Universo');
    expect(screen.getByText('Rango 5 de 5')).toBeInTheDocument();
    expect(screen.getByText('Llevas 4 sellos acumulados.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Te falta|Te faltan|5 sellos|quinto|sexto|Rango 6/i);
  });

  test.each([5, 6, 9, 20])('%i stamps → stays at the maximum rank, keeps the real count and creates nothing new', (stamps) => {
    show(progress(stamps, { level: 5, next: null }));
    expect(current()).toBe('Explorador del Universo');
    expect(screen.getByText('Rango 5 de 5')).toBeInTheDocument();
    expect(screen.getByText(`Llevas ${stamps} sellos acumulados.`)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('4 de 4 sellos')).toBeInTheDocument(); // the bar never overflows the ladder
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/Rango 6|Te falta/);
  });

  test('a level above the last one that the server might send is clamped, not drawn as a sixth rank', () => {
    show(progress(7, { level: 7, next: null }));
    expect(current()).toBe('Explorador del Universo');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('what each star says', () => {
  test('the five ranks keep their names and state what they ask for, discreetly under each star', () => {
    show(progress(0));
    const stars = within(screen.getByRole('list', { name: /Rangos/ })).getAllByRole('listitem');
    expect(stars.map((star) => star.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Cadete Espacial (alcanzado), rango inicial'),
      expect.stringContaining('Navegante Orbital (pendiente), se alcanza con 1 sello'),
      expect.stringContaining('Piloto Interestelar (pendiente), se alcanza con 2 sellos'),
      expect.stringContaining('Comandante de Misión (pendiente), se alcanza con 3 sellos'),
      expect.stringContaining('Explorador del Universo (pendiente), se alcanza con 4 sellos'),
    ]);
    const hints = [...document.querySelectorAll('ol[aria-label] > li > span[aria-hidden]:not(:first-of-type)')].map((el) => el.textContent);
    expect(hints).toEqual(['Inicio', '1 sello', '2 sellos', '3 sellos', '4 sellos']);
  });

  test('the explanation spells the ladder out: start, one stamp per rank, four for the last, no sixth', () => {
    show(progress(0));
    expect(screen.getByText(/Empiezas como Cadete Espacial\. Cada sello te sube un rango; con 4 sellos llegas a Explorador del Universo, el máximo\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sexto|Rango 6/);
  });

  test('the bar counts stamps towards the last rank', () => {
    const { unmount } = show(progress(0));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0 de 4 sellos')).toBeInTheDocument();
    unmount();
    show(progress(3));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 de 4 sellos para Explorador del Universo');
    expect(screen.getByText('3 de 4 sellos')).toBeInTheDocument();
  });

  test('the current rank is marked and the reached ones are counted as such', () => {
    show(progress(2));
    const stars = within(screen.getByRole('list', { name: /Rangos/ })).getAllByRole('listitem');
    expect(stars.map((star) => star.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null]);
    expect(stars[0]).toHaveTextContent('(alcanzado)');
    expect(stars[1]).toHaveTextContent('(alcanzado)');
    expect(stars[3]).toHaveTextContent('(pendiente)');
  });
});

describe('the expanded list of ranks', () => {
  test('lists the five ranks with what each one needs; the last is the maximum', () => {
    show(progress(1), true);
    const list = screen.getAllByRole('list').find((el) => el.tagName === 'OL' && !el.hasAttribute('aria-label'))!;
    const rows = within(list).getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('Rango inicial');
    expect(rows[1]).toContain('Con 1 sello');
    expect(rows[2]).toContain('Con 2 sellos');
    expect(rows[3]).toContain('Con 3 sellos');
    expect(rows[4]).toContain('Con 4 sellos · rango máximo');
    expect(rows[1]).toContain('(alcanzado)');
    expect(rows[2]).toContain('(pendiente)');
  });

  test('with 4 or more stamps every rank reads as reached', () => {
    show(progress(11, { level: 5, next: null }), true);
    const list = screen.getAllByRole('list').find((el) => el.tagName === 'OL' && !el.hasAttribute('aria-label'))!;
    for (const row of within(list).getAllByRole('listitem')) expect(row).toHaveTextContent('(alcanzado)');
  });
});

describe('when the progression is no longer one stamp per rank', () => {
  test('the screen does not claim per-rank requirements it cannot vouch for', () => {
    const other = progress(1, { next: { level: 3, required_attendances: 3, required_divisions: 1 } });
    expect(isStampLadder(other)).toBe(false);
    show(other, true);
    expect(document.body.textContent).not.toMatch(/Con 1 sello|se alcanza con|Cada sello te sube|con 4 sellos llegas/);
  });
});

test('helpers: rank n needs n-1 stamps and the last needs four', () => {
  expect([1, 2, 3, 4, 5].map(stampsForRank)).toEqual([0, 1, 2, 3, 4]);
  expect(MAX_RANK_STAMPS).toBe(4);
  expect(isStampLadder(progress(0))).toBe(true);
  expect(isStampLadder(progress(4))).toBe(true);
});
