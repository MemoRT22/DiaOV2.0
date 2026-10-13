import type { RaffleScope } from './raffleShow';

/**
 * Coordinación's choice of the records used for the rehearsal. It is a preference of this browser (the server keeps no
 * such thing and nothing about it was added): it only applies while the edition is in rehearsal and is looked up per
 * edition, so the official operation can never inherit it.
 */
const key = (editionId: string) => `diaov:raffle:rehearsal-set:${editionId}`;

export function readSetChoice(editionId: string): RaffleScope | null {
  try {
    const value = window.localStorage.getItem(key(editionId));
    return value === 'real' || value === 'demo' ? value : null;
  } catch { return null; }
}

export function writeSetChoice(editionId: string, set: RaffleScope) {
  try { window.localStorage.setItem(key(editionId), set); } catch { /* without storage the choice is asked again next time */ }
}
