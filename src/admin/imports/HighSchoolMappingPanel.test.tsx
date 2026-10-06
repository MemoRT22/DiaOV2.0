import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { fetchCareers, fetchHighSchools } from '../../lib/catalog';
import CareerMappingPanel from './CareerMappingPanel';

vi.mock('../../lib/catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/catalog')>(),
  fetchCareers: vi.fn(), fetchHighSchools: vi.fn(),
}));

test('groups an unknown school, maps it by catalog ID and offers a way to refresh after catalog addition', async () => {
  vi.mocked(fetchCareers).mockResolvedValue([]);
  vi.mocked(fetchHighSchools).mockResolvedValue([{ id: 'h-1', name: 'Otra escuela', is_active: true }]);
  const apply = vi.fn().mockResolvedValue(undefined);
  render(<CareerMappingPanel result={{ counts: {}, rows: [], unmatched_high_schools: [{ key: 'preparatoria nueva', value: 'Preparatoria Nueva', count: 17, target: null }] }}
    options={{}} isDemo={false} busy={false} apply={apply} />);
  expect(screen.getByText('Preparatoria no reconocida')).toBeInTheDocument();
  expect(screen.getByText('17 filas')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Catálogos académicos/ })).toHaveAttribute('href', '/coordinacion/configuracion/catalogo?tab=high_schools');
  fireEvent.click(screen.getByRole('combobox', { name: 'Preparatoria oficial para Preparatoria Nueva' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Otra escuela' }));
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar y actualizar vista previa' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith({ careerMap: {}, careerMap2: {}, highSchoolMap: { 'preparatoria nueva': 'h-1' } }));
});
