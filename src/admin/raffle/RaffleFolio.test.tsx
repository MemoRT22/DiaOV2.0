import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PublicStage } from './RaffleStage';
import RaffleStage from './RaffleStage';
import { useWinnerFolios } from './useWinnerFolios';

const m = vi.hoisted(() => ({ folios: vi.fn() }));
vi.mock('../../lib/raffleWinner', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/raffleWinner')>()), fetchWinnerFolios: m.folios }));

const result = { winnerId: 'w1', name: 'Valeria Méndez Castillo', prizeName: 'Nintendo Switch OLED', categoryName: 'Galaxia', poolSize: 12, fresh: false };
const stage = (variant: 'panel' | 'projection', folio?: string | null) => render(
  <RaffleStage variant={variant} phase="revealed" rehearsal={false} prize={{ name: 'Nintendo Switch OLED', available: 1, quantity: 2 }} poolCount={12} result={result} categoryName="Galaxia" folio={folio} alreadyRevealed />,
);

describe('folio en la consola del operador', () => {
  test('el panel muestra nombre, premio y folio del ganador', () => {
    stage('panel', 'GAN-000123');
    expect(screen.getByText('Valeria Méndez Castillo', { selector: '[aria-hidden]' })).toBeInTheDocument();
    expect(screen.getByText('Nintendo Switch OLED', { selector: '.rf-prize-sub' })).toBeInTheDocument();
    expect(screen.getByTestId('winner-folio')).toHaveTextContent('Folio: GAN-000123');
  });
  test('mientras se lee, «…»; si no se pudo leer, «no disponible» (no bloquea nada)', () => {
    const { unmount } = stage('panel', undefined);
    expect(screen.getByTestId('winner-folio')).toHaveTextContent('Folio: …');
    unmount();
    stage('panel', null);
    expect(screen.getByTestId('winner-folio')).toHaveTextContent('Folio: no disponible');
  });
  test('la pantalla pública del proyector NUNCA muestra el folio, aunque se le entregue', () => {
    stage('projection', 'GAN-000123');
    expect(screen.queryByTestId('winner-folio')).toBeNull();
    expect(document.body).not.toHaveTextContent('GAN-000123');
  });
  test('la proyección construida desde el estado público no tiene por dónde recibirlo', () => {
    render(<PublicStage state={{ phase: 'revealed', rehearsal: false, categoryName: 'Galaxia', prize: { name: 'Switch', available: 1, quantity: 2 }, poolCount: 3, result: { winnerId: 'w1', name: 'Ana', prizeName: 'Switch', poolSize: 3, fresh: false } } as never} alreadyRevealed />);
    expect(screen.queryByTestId('winner-folio')).toBeNull();
  });
});

function Probe({ ids }: { ids: string[] }) {
  const { folioOf } = useWinnerFolios(ids);
  return <p data-testid="probe">{ids.map((id) => `${id}=${String(folioOf(id))}`).join(' ')}</p>;
}

describe('lectura de folios', () => {
  beforeEach(() => vi.clearAllMocks());
  test('se piden una vez por resultado y llegan por id', async () => {
    m.folios.mockResolvedValue(new Map([['w1', 'GAN-000001'], ['w2', 'GAN-000002']]));
    const view = render(<Probe ids={['w2', 'w1']} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('w2=GAN-000002 w1=GAN-000001'));
    view.rerender(<Probe ids={['w1', 'w2']} />);
    expect(m.folios).toHaveBeenCalledTimes(1);
  });
  test('si la lectura falla o el servidor no conoce el resultado, queda «null» (no disponible) y no se rompe', async () => {
    m.folios.mockRejectedValue(new Error('network'));
    render(<Probe ids={['w9']} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('w9=null'));
  });
  test('al llegar resultados nuevos solo se piden esos, no todo el historial otra vez', async () => {
    m.folios.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, `GAN-${id.slice(1).padStart(6, '0')}`])));
    const view = render(<Probe ids={['w1', 'w2']} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('w2=GAN-000002'));
    view.rerender(<Probe ids={['w1', 'w2', 'w3']} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('w3=GAN-000003'));
    expect(m.folios.mock.calls.map((call) => call[0])).toEqual([['w1', 'w2'], ['w3']]);
  });
  test('un historial grande (1,200 resultados) llega completo: nadie queda «no disponible» por el tamaño', async () => {
    const many = Array.from({ length: 1200 }, (_, n) => `w${n}`);
    m.folios.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, `GAN-${id.slice(1).padStart(6, '0')}`])));
    render(<Probe ids={many} />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('w1199=GAN-001199'));
    expect(screen.getByTestId('probe').textContent).not.toContain('=null');
    expect(m.folios).toHaveBeenCalledTimes(1); // el reparto en lotes lo hace fetchWinnerFolios
  });
  test('sin resultados no consulta nada', () => {
    render(<Probe ids={[]} />);
    expect(m.folios).not.toHaveBeenCalled();
  });
});

test('la consola del operador rotula «Ganador seleccionado»; la pantalla pública sigue diciendo «Ganador»', () => {
  const panel = stage('panel', 'GAN-000123');
  expect(screen.getByText('Ganador seleccionado')).toBeInTheDocument();
  panel.unmount();
  stage('projection');
  expect(screen.getByText('Ganador')).toBeInTheDocument();
  expect(screen.queryByText('Ganador seleccionado')).toBeNull();
});
