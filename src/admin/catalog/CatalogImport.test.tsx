import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import CatalogImport from './CatalogImport';

vi.mock('../../lib/adminApi', () => ({ rpc: vi.fn() }));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'preparacion' } }) }));

test('catalog import offers careers only and no second workshop creation path', () => {
  render(<MemoryRouter><CatalogImport /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Importar carreras' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Talleres y horarios' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Carga carreras o talleres/)).not.toBeInTheDocument();
});
