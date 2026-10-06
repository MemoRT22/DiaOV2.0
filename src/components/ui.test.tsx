import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Modal } from './ui';

test('a dialog is rendered on <body>, so an animated or transformed ancestor can never displace it', () => {
  const { container } = render(
    <div style={{ transform: 'translateY(0)' }} data-testid="animated-page">
      <Modal title="Nueva cuenta" onClose={() => undefined}><p>Contenido</p></Modal>
    </div>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Nueva cuenta' });
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.closest('[data-testid="animated-page"]')).toBeNull();
  expect(document.body.contains(dialog)).toBe(true);
});

test('page scroll is locked while a dialog is open and restored when it closes', () => {
  document.body.style.overflow = 'auto';
  const { unmount } = render(<Modal title="Editar" onClose={() => undefined}><p>x</p></Modal>);
  expect(document.body.style.overflow).toBe('hidden');
  unmount();
  expect(document.body.style.overflow).toBe('auto');
});

test('Escape and the close button dismiss the dialog', () => {
  const onClose = vi.fn();
  render(<Modal title="Editar" onClose={onClose}><p>x</p></Modal>);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
