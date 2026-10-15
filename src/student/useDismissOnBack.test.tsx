import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sheetEntryActive, useDismissOnBack } from './useDismissOnBack';

/** A screen with a sheet that can be opened and closed, like the booking sheet. */
function Screen({ onDismiss = () => undefined, refuse = false }: { onDismiss?: () => void; refuse?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>abrir</button>
      {open && <Sheet onClose={() => { setOpen(false); onDismiss(); }} refuse={refuse} />}
    </div>
  );
}
function Sheet({ onClose, refuse }: { onClose: () => void; refuse: boolean }) {
  useDismissOnBack(() => { if (refuse) return false; onClose(); });
  return <div role="dialog"><button onClick={onClose}>cerrar</button></div>;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const goBack = async () => { act(() => { window.history.back(); }); await settle(); };

let baseline: number;
beforeEach(() => {
  window.history.replaceState({ usr: null, key: 'k0', idx: 0 }, '');
  baseline = window.history.length;
});
afterEach(async () => { await settle(); });

describe('a sheet is a place the Back button can return from', () => {
  test('opening adds exactly one history entry, with the router state intact', async () => {
    const view = render(<Screen />);
    act(() => view.getByText('abrir').click());
    expect(view.getByRole('dialog')).toBeInTheDocument();
    expect(window.history.length).toBe(baseline + 1);
    expect(sheetEntryActive()).toBe(true);
    expect(window.history.state).toMatchObject({ usr: null, key: 'k0', idx: 0 });
  });

  test('Back closes the sheet and stays on the same screen (it does not leave it)', async () => {
    const onDismiss = vi.fn();
    const view = render(<Screen onDismiss={onDismiss} />);
    const url = window.location.href;
    act(() => view.getByText('abrir').click());
    await goBack();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(url);
    expect(sheetEntryActive()).toBe(false);
  });

  test('closing with its own button gives the entry back: the next Back is not wasted on a ghost entry', async () => {
    const view = render(<Screen />);
    act(() => view.getByText('abrir').click());
    act(() => view.getByText('cerrar').click());
    await settle();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sheetEntryActive()).toBe(false);
    expect(window.history.state).toMatchObject({ key: 'k0', idx: 0 });
  });

  test('opening again right after closing is not mistaken for the entry that is still being removed', async () => {
    const view = render(<Screen />);
    act(() => view.getByText('abrir').click());
    act(() => view.getByText('cerrar').click());
    act(() => view.getByText('abrir').click()); // before the first entry finished going away
    await settle();
    expect(view.getByRole('dialog')).toBeInTheDocument(); // the late popstate must not close the new sheet
    expect(sheetEntryActive()).toBe(true);
    await goBack();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('opening again while the previous entry is already on its way out waits for it and is not closed by its popstate', async () => {
    const view = render(<Screen />);
    act(() => view.getByText('abrir').click());
    act(() => view.getByText('cerrar').click());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))); // history.back() has been requested, popstate has not arrived
    act(() => view.getByText('abrir').click());
    await settle();
    expect(view.getByRole('dialog')).toBeInTheDocument();
    expect(sheetEntryActive()).toBe(true);
    expect(window.history.length).toBeLessThanOrEqual(baseline + 2);
    await goBack();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sheetEntryActive()).toBe(false);
  });

  test('a sheet that cannot be dismissed (an action in progress) survives Back and keeps its entry', async () => {
    const onDismiss = vi.fn();
    const view = render(<Screen onDismiss={onDismiss} refuse />);
    act(() => view.getByText('abrir').click());
    await goBack();
    expect(view.getByRole('dialog')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(sheetEntryActive()).toBe(true);
  });

  test('leaving the sheet by REPLACING its entry (go to Mi ruta) leaves nothing behind to remove', async () => {
    const view = render(<Screen />);
    act(() => view.getByText('abrir').click());
    expect(sheetEntryActive()).toBe(true);
    // what the app does when it navigates away from the sheet: the router replaces the current entry with the destination
    act(() => { window.history.replaceState({ usr: null, key: 'k1', idx: 1 }, '', '/ruta'); });
    expect(sheetEntryActive()).toBe(false);
    const length = window.history.length;
    act(() => view.getByText('cerrar').click());
    await settle();
    expect(window.history.length).toBe(length); // no history.back(): the destination stays where it is
    expect(window.location.pathname).toBe('/ruta');
    window.history.replaceState(null, '', '/');
  });

  test('React StrictMode (mount, unmount, mount) still ends with a single entry', async () => {
    const { StrictMode } = await import('react');
    const view = render(<StrictMode><Screen /></StrictMode>);
    act(() => view.getByText('abrir').click());
    await settle();
    expect(window.history.length).toBe(baseline + 1);
    expect(view.getByRole('dialog')).toBeInTheDocument();
    await goBack();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
