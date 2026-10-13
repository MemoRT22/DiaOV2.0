import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import type { ExportFile } from '../../lib/checkinExportRun';
import { createFakeServer } from '../../test/qrExportFixtures';
import QrExport from './QrExport';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
const saved = vi.hoisted(() => [] as ExportFile[]);
vi.mock('../../lib/checkinExportRun', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/checkinExportRun')>(),
  saveFile: (file: ExportFile) => { saved.push(file); },
}));

let server = createFakeServer();
const calls: string[] = [];

beforeEach(() => {
  server = createFakeServer();
  saved.length = 0;
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(rpc).mockImplementation((async (name: string, args?: { p_activity?: string }) => {
    calls.push(name);
    if (name === 'activity_export_metadata') return [...server.meta.values()].map((m) => structuredClone(m));
    if (name === 'activity_credential_display') return server.deps().fetchCredential!(args!.p_activity!);
    throw new Error(`rpc inesperada: ${name}`);
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

const show = () => render(<MemoryRouter><QrExport /></MemoryRouter>);
const count = (label: string) => within(screen.getByText(label).closest('div')!).getByText(/^\d+$/).textContent;

describe('pantalla de descarga de QR', () => {
  test('antes de descargar muestra los totales de los 64 talleres reales; los DEMO quedan fuera', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Descargar QR de talleres' })).toBeInTheDocument();
    expect(count('Talleres seleccionados')).toBe('64');
    expect(count('QR a incluir')).toBe('64');
    expect(count('Responsables')).toBe('40');
    expect(count('Documentos PDF')).toBe('43'); // 40 responsables + 3 sin responsable
    expect(count('Páginas')).toBe('64');
    const demo = screen.getByRole('checkbox', { name: /Incluir talleres DEMO \(9\)/ });
    expect(demo).not.toBeChecked();
    expect(screen.getByText(/Son de prueba y no deben llegar a talleristas/)).toBeInTheDocument();
    const warnings = screen.getByRole('list', { name: 'Avisos de la selección' });
    expect(warnings).toHaveTextContent(/Sin responsable\s*3 talleres/);
    expect(warnings).toHaveTextContent(/Sin correo\s*4 talleres tienen responsable sin correo/);
    expect(warnings).toHaveTextContent(/Sin división\s*3 talleres académicos sin división asignada/);
    expect(warnings).not.toHaveTextContent(/DEMO/);
    expect(calls).not.toContain('activity_credential_display'); // ver totales no pide ninguna credencial
  });

  test('advierte que regenerar invalida los PDF ya descargados', async () => {
    show();
    expect(await screen.findByText(/dejan de funcionar/)).toBeInTheDocument();
  });

  test('incluir DEMO los marca y cambia los totales', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('checkbox', { name: /Incluir talleres DEMO/ }));
    expect(count('Talleres seleccionados')).toBe('73');
    expect(screen.getByText(/9 talleres de prueba incluidos/)).toBeInTheDocument();
    expect(screen.getAllByText('DEMO').length).toBeGreaterThan(9);
  });

  test('cambiar de formato recalcula documentos y páginas', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.click(screen.getByRole('radio', { name: /Por división/ }));
    expect(count('Divisiones o grupos')).toBe('8'); // 6 divisiones + Vida Universitaria + Sin división
    expect(Number(count('Páginas'))).toBeGreaterThan(64);
    expect(screen.getByText(/páginas repetidas/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Concentrado general/ }));
    expect(count('Documentos PDF')).toBe('1');
    expect(count('Páginas')).toBe('64');
  });

  test('los filtros reducen la selección (tipo, texto)', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.click(screen.getByRole('checkbox', { name: 'Vida Universitaria' }));
    expect(count('Talleres seleccionados')).toBe('12');
    await user.click(screen.getByRole('button', { name: /Limpiar filtros/ }));
    expect(count('Talleres seleccionados')).toBe('64');
    await user.type(screen.getByRole('textbox', { name: 'Buscar' }), 'robótica');
    expect(Number(count('Talleres seleccionados'))).toBeLessThan(64);
  });

  test('descarga un solo archivo: ZIP por tallerista con la lista de control, y avisa qué incluyó', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.click(screen.getByRole('checkbox', { name: 'Vida Universitaria' }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar' }), 'Edificio A');
    const total = Number(count('Talleres seleccionados'));
    expect(total).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^Descargar ZIP/ }));
    expect(await screen.findByText(/Descarga lista/, undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toMatch(/^DiaOV2026_QR_Talleristas_\d{4}-\d{2}-\d{2}\.zip$/);
    expect(screen.getByText(new RegExp(`Incluye ${total} ${total === 1 ? 'taller' : 'talleres'}`))).toBeInTheDocument();
    expect(screen.getByText(/No se envió ningún correo/)).toBeInTheDocument();
    expect(calls.filter((name) => name === 'activity_credential_display')).toHaveLength(total); // una credencial por taller, nada se regenera
    expect(calls.some((name) => /regenerate|rotate/.test(name))).toBe(false);
  }, 60_000);

  test('si un QR no se puede obtener no descarga nada, dice cuál y permite reintentar', async () => {
    const user = userEvent.setup();
    server.failOn('act-05', 2);
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.click(screen.getByRole('radio', { name: /Concentrado general/ }));
    await user.click(screen.getByRole('checkbox', { name: /Incluir la lista de control/ }));
    await user.type(screen.getByRole('textbox', { name: 'Buscar' }), 'Edificio A');
    await user.click(screen.getByRole('button', { name: /^Descargar PDF ·/ }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 30_000 });
    expect(alert).toHaveTextContent(/No se pudo obtener el QR de 1 taller/);
    expect(alert).toHaveTextContent(/No se descargó nada/);
    expect(alert).toHaveTextContent('Oratoria 6');
    expect(saved).toHaveLength(0);
    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText(/Descarga lista/, undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0].mime).toBe('application/pdf');
  }, 90_000);

  test('descargar incompleto exige confirmar y dice exactamente qué queda fuera', async () => {
    const user = userEvent.setup();
    server.failOn('act-05');
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.type(screen.getByRole('textbox', { name: 'Buscar' }), 'Edificio A');
    await user.click(screen.getByRole('button', { name: /^Descargar ZIP/ }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 30_000 });
    await user.click(within(alert).getByRole('button', { name: /Descargar sin esos 1/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('No se incluirán');
    expect(dialog).toHaveTextContent('Oratoria 6');
    expect(saved).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Descargar incompleto' }));
    expect(await screen.findByText(/Archivo INCOMPLETO/, undefined, { timeout: 30_000 })).toBeInTheDocument();
    expect(saved[0].name).toContain('_INCOMPLETO');
  }, 90_000);

  test('bajar el PDF de un solo taller', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Descargar QR de talleres' });
    await user.click(screen.getByRole('button', { name: 'Descargar PDF de Cocina molecular 1' }));
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 30_000 });
    expect(saved[0].name).toBe('DiaOV2026_QR_Cocina-molecular-1.pdf');
    expect(calls.filter((name) => name === 'activity_credential_display')).toHaveLength(1);
  }, 60_000);

  test('un taller sin horarios vigentes se avisa y su botón no descarga', async () => {
    server.meta.get('act-01')!.sessions.forEach((s) => { s.status = 'cancelada'; });
    show();
    expect(await screen.findByText(/1 taller sin horarios vigentes/)).toBeInTheDocument();
    expect(count('Talleres seleccionados')).toBe('64');
    expect(count('QR a incluir')).toBe('63');
    expect(screen.getByRole('button', { name: 'Descargar PDF de Primeros auxilios 2' })).toBeDisabled();
  });

  test('si no se pueden leer los metadatos muestra el error con reintento', async () => {
    vi.mocked(rpc).mockRejectedValue(new Error('NOT_AUTHORIZED'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No tienes permiso/);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
