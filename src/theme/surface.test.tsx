import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import AdminSurface from '../admin/AdminSurface';
import { adminCssVars } from '../admin/adminTheme';
import { neutralTheme } from './neutralTheme';
import { PublicSurface, PublicThemeProvider, usePublicTheme } from './PublicThemeProvider';
import { paintAdminSurface, paintPublicTheme } from './surface';
import { themeCssVars } from './themeEngine';

const { LOUD_COLORS } = vi.hoisted(() => ({
  LOUD_COLORS: { primary: '#00FF00', secondary: '#FF00FF', background: '#05070D', surface: '#101830', ink: '#F8FAFC' },
}));

vi.mock('../edition/EditionProvider', () => ({
  useEdition: () => ({ edition: { id: 'ed-1' }, loading: false, reloadEdition: vi.fn() }),
}));
vi.mock('../lib/supabase', async () => {
  const { neutralTheme: base } = await import('./neutralTheme');
  const config = { ...base, colors: { ...base.colors, ...LOUD_COLORS }, typography: { display: 'Pacifico', body: 'Comic Neue' }, radius: 28,
    style: { ...base.style, background: 'starfield' } };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: { config }, error: null });
  return { supabase: { from: () => chain } };
});

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable in this environment */
  }
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-background');
});

function Probe() {
  const { theme } = usePublicTheme();
  return <p>tema público: {theme.colors.primary}</p>;
}

function App({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <PublicThemeProvider>
        <Routes>
          <Route element={<PublicSurface />}>
            <Route path="/" element={<div><Probe /><Link to="/coordinacion">ir al admin</Link></div>} />
          </Route>
          <Route element={<AdminSurface />}>
            <Route path="/coordinacion" element={<div><Probe /><Link to="/">ir al portal</Link></div>} />
          </Route>
        </Routes>
      </PublicThemeProvider>
    </MemoryRouter>
  );
}

test('admin variables are fixed and independent from any public theme', () => {
  const admin = adminCssVars();
  const loud = themeCssVars({ ...neutralTheme, colors: { ...neutralTheme.colors, ...LOUD_COLORS } });
  expect(admin).toEqual(adminCssVars());
  expect(admin['--c-primary-500']).not.toBe(loud['--c-primary-500']);
  expect(admin['--font-display']).toContain('Montserrat');
  expect(admin['--radius']).toBe('10px');
  // readable foregrounds for states, charts and alerts are dark tones on the light admin canvas
  expect(admin['--fg-error']).toBe(admin['--c-error-700']);
  expect(loud['--fg-error']).toBe(loud['--c-error-200']);
});

test('painting the admin removes every trace of the public theme', () => {
  paintPublicTheme({ ...neutralTheme, typography: { display: 'Pacifico', body: 'Comic Neue' }, style: { ...neutralTheme.style, background: 'starfield' } });
  expect(rootVar('--font-display')).toContain('Pacifico');
  expect(document.documentElement.dataset.background).toBe('starfield');
  paintAdminSurface();
  expect(rootVar('--font-display')).toContain('Montserrat');
  expect(rootVar('--radius')).toBe('10px');
  expect(rootVar('--surface-sunken')).toBe(adminCssVars()['--surface-sunken']);
  expect(document.documentElement.dataset.background).toBeUndefined();
  expect(document.documentElement.style.colorScheme).toBe('light');
});

test('a published public theme never reaches the admin, but does reach the public portal', async () => {
  render(<App start="/coordinacion" />);
  // the theme is loaded and available as data inside the admin...
  expect(await screen.findByText('tema público: #00FF00')).toBeInTheDocument();
  // ...yet the document keeps the fixed admin system
  expect(rootVar('--c-primary-500')).toBe(adminCssVars()['--c-primary-500']);
  expect(rootVar('--font-display')).toContain('Montserrat');
  expect(rootVar('--surface')).toBe(adminCssVars()['--surface']);
  expect(rootVar('--radius')).toBe('10px');
  expect(document.documentElement.dataset.background).toBeUndefined();

  fireEvent.click(screen.getByRole('link', { name: 'ir al portal' }));
  await waitFor(() => expect(rootVar('--font-display')).toContain('Pacifico'));
  expect(rootVar('--c-primary-500')).toBe(themeCssVars({ ...neutralTheme, colors: { ...neutralTheme.colors, ...LOUD_COLORS } })['--c-primary-500']);
  expect(rootVar('--radius')).toBe('28px');
  expect(document.documentElement.dataset.background).toBe('starfield');
  expect(document.documentElement.style.colorScheme).toBe('dark');

  fireEvent.click(screen.getByRole('link', { name: 'ir al admin' }));
  await waitFor(() => expect(rootVar('--font-display')).toContain('Montserrat'));
  expect(rootVar('--radius')).toBe('10px');
  expect(document.documentElement.dataset.background).toBeUndefined();
});
