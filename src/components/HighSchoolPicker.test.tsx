import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import HighSchoolPicker from './HighSchoolPicker';

const options = [
  { id: 'boston', name: 'Colegio Boston (Cancún)', is_active: true },
  { id: 'cecyte-1', name: 'Cecyte No. 1 Cancún (Cancún)', is_active: true },
  { id: 'cecyte-2', name: 'Cecyte No. 2 Cancún (Cancún)', is_active: true },
  { id: 'other', name: 'Otra escuela', is_active: true },
  { id: 'retired', name: 'Plantel retirado', is_active: false },
];

test('filters by partial name and returns only the selected catalog ID', async () => {
  const onChange = vi.fn();
  render(<HighSchoolPicker options={options} value="" onChange={onChange} required />);
  const picker = screen.getByRole('combobox', { name: 'Escuela / preparatoria' });
  fireEvent.click(picker);
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar preparatoria' }), 'boston');
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Colegio Boston (Cancún)' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('boston');
  expect(picker).toHaveAttribute('aria-expanded', 'false');
});

test('finds multiple Cecyte campuses and includes Otra escuela', async () => {
  render(<HighSchoolPicker options={options} value="" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Escuela / preparatoria' }));
  const search = screen.getByRole('textbox', { name: 'Buscar preparatoria' });
  await userEvent.type(search, 'CECYTE');
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
  await userEvent.clear(search);
  await userEvent.type(search, 'otra');
  expect(screen.getByRole('button', { name: 'Otra escuela' })).toBeInTheDocument();
});

test('shows an inactive historical selection but excludes it from new choices', () => {
  const onChange = vi.fn();
  render(<HighSchoolPicker options={options} value="retired" onChange={onChange} />);
  const picker = screen.getByRole('combobox', { name: 'Escuela / preparatoria' });
  expect(picker).toHaveTextContent('Plantel retirado');
  expect(picker).toHaveTextContent('Inactiva');
  fireEvent.click(picker);
  expect(screen.queryByRole('button', { name: 'Plantel retirado' })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
