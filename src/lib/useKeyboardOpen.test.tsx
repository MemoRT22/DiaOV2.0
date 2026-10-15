import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { KEYBOARD_MIN_PX, useKeyboardOpen } from './useKeyboardOpen';

let vv: EventTarget & { height: number };
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

beforeEach(() => {
  vv = Object.assign(new EventTarget(), { height: 800 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
});
afterEach(() => { if (original) Object.defineProperty(window, 'visualViewport', original); else delete (window as { visualViewport?: unknown }).visualViewport; });

function Screen() {
  const open = useKeyboardOpen();
  return (<><input aria-label="buscar" type="search" /><input aria-label="aceptar" type="checkbox" /><output>{open ? 'teclado' : 'sin teclado'}</output></>);
}
const resize = (height: number) => act(() => { vv.height = height; vv.dispatchEvent(new Event('resize')); });

test('a focused text field alone is not a keyboard (hardware keyboard, or the keyboard was dismissed)', async () => {
  render(<Screen />);
  await userEvent.click(screen.getByLabelText('buscar'));
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
});

test('the keyboard is open when a text field has focus AND the visible height shrank by a keyboard\'s worth', async () => {
  render(<Screen />);
  await userEvent.click(screen.getByLabelText('buscar'));
  resize(800 - KEYBOARD_MIN_PX - 150);
  expect(screen.getByRole('status')).toHaveTextContent('teclado');
});

test('closing the keyboard (the viewport grows back) shows the bar again even if the field keeps focus', async () => {
  render(<Screen />);
  await userEvent.click(screen.getByLabelText('buscar'));
  resize(480);
  expect(screen.getByRole('status')).toHaveTextContent('teclado');
  resize(800);
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
});

test('blurring the field brings the bar back', async () => {
  render(<Screen />);
  await userEvent.click(screen.getByLabelText('buscar'));
  resize(480);
  await userEvent.tab(); // moves focus to the checkbox, which is not a text field
  await act(() => new Promise<void>((r) => setTimeout(r, 5)));
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
});

test('a smaller viewport with nothing focused (rotation, browser bars) is just the new normal, never a keyboard', () => {
  render(<Screen />);
  resize(400);
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
});

test('checkboxes and buttons never count as typing', async () => {
  render(<Screen />);
  await userEvent.click(screen.getByLabelText('aceptar'));
  resize(450);
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
});

test('a browser without visualViewport leaves the bar alone', () => {
  delete (window as { visualViewport?: unknown }).visualViewport;
  render(<Screen />);
  expect(screen.getByRole('status')).toHaveTextContent('sin teclado');
  vi.restoreAllMocks();
});
