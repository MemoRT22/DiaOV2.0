import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import RaffleStage, { type StagePhase } from './RaffleStage';

afterEach(() => vi.unstubAllGlobals());

const props = {
  variant: 'projection' as const, rehearsal: false, categoryName: 'Sistema Solar',
  prize: { name: 'Premio de prueba', available: 1, quantity: 1 }, poolCount: 120,
  result: null,
};

test('the LED scenery is decorative, bounded and never adds public controls', () => {
  const { container } = render(<RaffleStage {...props} phase="drawing" />);
  const cosmos = container.querySelector('.rf-orbits');
  expect(cosmos).toHaveAttribute('aria-hidden', 'true');
  expect(cosmos).toHaveAttribute('data-phase', 'drawing');
  expect(container.querySelector('.rf-planet')).toBeNull();
  expect(cosmos?.querySelectorAll('.rf-ring')).toHaveLength(3);
  expect(cosmos?.querySelectorAll('.rf-ring i')).toHaveLength(54);
  expect(screen.getByRole('status')).toHaveTextContent('Sorteando');
  expect(container.querySelectorAll('button, input, a')).toHaveLength(0);
});

test('winner and confirmation stay readable with reduced motion, with no celebration replay', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const done = vi.fn();
  const result = { winnerId: 'test-winner', name: 'Exploradora de Prueba', prizeName: 'Premio de prueba', categoryName: 'Sistema Solar', poolSize: 120, fresh: true };
  const { container, rerender } = render(<RaffleStage {...props} phase="revealed" result={result} onRevealDone={done} />);
  expect(container.querySelector('.rf-stage')).toHaveAttribute('data-motion', 'reduced');
  expect(container.querySelector('.rf-winner')).toHaveTextContent(result.name);
  expect(screen.getByRole('status')).toHaveTextContent(`Ganador: ${result.name}`);
  expect(container.querySelector('.rf-burst')).toBeNull();
  expect(done).toHaveBeenCalledTimes(1);
  rerender(<RaffleStage {...props} phase="confirmed" result={result} />);
  expect(screen.getByText('Entrega confirmada')).toBeInTheDocument();
});

test.each<StagePhase>(['idle', 'drawing', 'revealed', 'confirmed', 'uncertain'])('decorations do not replace the %s phase', (phase) => {
  const { container } = render(<RaffleStage {...props} phase={phase} />);
  expect(container.querySelector('.rf-stage')).toHaveAttribute('data-phase', phase);
  expect(container.querySelector('.rf-orbits')).toHaveAttribute('data-phase', phase);
});
