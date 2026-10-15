import { useEffect, useState } from 'react';

/** How much of the visible height must disappear for it to count as «the on-screen keyboard is open». */
export const KEYBOARD_MIN_PX = 120;

const isEditable = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image', 'color'].includes(el.type)));

/**
 * Is the on-screen keyboard up? True only when a text field has focus AND the visible height has shrunk by more than a keyboard's worth
 * relative to what it was with nothing focused. Both conditions matter: a focused field alone does not mean a keyboard (a hardware
 * keyboard, or the keyboard dismissed with the field still focused), and a smaller viewport alone can be a rotation or the browser's own
 * bar. Works whether the browser resizes the layout (older Chrome) or only the visual viewport (current Chrome, Safari).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let baseline = vv.height; // the visible height with nothing focused
    const typing = () => isEditable(document.activeElement);
    const update = () => {
      if (!typing()) baseline = vv.height; // rotation, the browser's own bars… all of that is the new normal
      setOpen(typing() && baseline - vv.height > KEYBOARD_MIN_PX);
    };
    const afterBlur = () => { setTimeout(update, 0); };
    vv.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', afterBlur);
    return () => {
      vv.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', afterBlur);
    };
  }, []);
  return open;
}
