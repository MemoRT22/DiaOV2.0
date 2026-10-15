import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ClampedText } from './ClampedText';

const layout = (scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight });
};
afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight; delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight; });

const LONG = 'Descubre cómo se vive esta carrera desde la práctica. '.repeat(8).trim();

test('short text shows no button at all', () => {
  layout(60, 60);
  render(<ClampedText text="Una frase corta." lines={3} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('long text is clamped, the whole text stays in the page, and «Leer más» opens it in place', () => {
  layout(240, 80);
  render(<ClampedText text={LONG} lines={3} />);
  const text = screen.getByText(LONG);
  expect(text.className).toMatch(/line-clamp-3/);
  const toggle = screen.getByRole('button', { name: 'Leer más' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(text.className).not.toMatch(/line-clamp/);
  expect(screen.getByRole('button', { name: 'Leer menos' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Leer menos' }));
  expect(text.className).toMatch(/line-clamp-3/);
});

test('the toggle is a real touch target', () => {
  layout(240, 80);
  render(<ClampedText text={LONG} lines={4} />);
  expect(screen.getByRole('button', { name: 'Leer más' }).className).toMatch(/min-h-11/);
});
