import { useState } from 'react';
import { Button } from '../../components/ui';
import type { RaffleCategory } from '../../lib/raffleApi';
import { officialCategory } from '../../lib/raffleCatalog';
import { scopeOf, type RaffleScope } from '../../lib/raffleShow';

export const SET_LABEL: Record<RaffleScope, string> = {
  real: 'Participantes cargados hasta ahora',
  demo: 'Participantes de prueba del sistema',
};

const OPTIONS: { set: RaffleScope; help: string }[] = [
  { set: 'real', help: 'Los registros temporales que ya están en la plataforma (el sistema todavía los marca como oficiales; se limpiarán antes del evento).' },
  { set: 'demo', help: 'Los registros que el sistema marca como de prueba. Son los únicos con los que puede ensayar una cuenta de Sorteo.' },
];

/**
 * Guided step of the rehearsal, only for Coordinación: with which records will it be rehearsed. It is asked once, shows
 * what each option holds so the decision is informed, and is never made for them from those numbers.
 */
export default function RaffleSetChooser({ categories, current, onChoose, onCancel }: {
  categories: RaffleCategory[]; current: RaffleScope | null; onChoose: (set: RaffleScope) => void; onCancel?: () => void;
}) {
  const [picked, setPicked] = useState<RaffleScope | null>(current);
  const info = (set: RaffleScope) => {
    const official = categories.filter((category) => scopeOf(category) === set && officialCategory(category.name));
    return { categories: official.length, eligible: official.reduce((sum, category) => sum + (category.pool_count ?? 0), 0) };
  };
  return (
    <section className="rf-chooser" aria-label="Registros del ensayo">
      <h2>¿Con qué registros se hará el ensayo?</h2>
      <p>El ensayo guarda sus selecciones como pruebas. Elige los participantes con los que quieres ensayar; podrás cambiarlo mientras no haya una ronda en curso. El sorteo oficial siempre usa los registros oficiales.</p>
      <div className="rf-chooser-options" role="radiogroup" aria-label="Registros del ensayo">
        {OPTIONS.map(({ set, help }) => {
          const { categories: count, eligible } = info(set);
          const usable = count > 0;
          return (
            <label key={set} className="rf-chooser-option" data-checked={picked === set || undefined} data-disabled={!usable || undefined}>
              <input type="radio" name="rf-set" checked={picked === set} disabled={!usable} onChange={() => setPicked(set)} />
              <span className="rf-chooser-body">
                <strong>{SET_LABEL[set]}</strong>
                <span>{help}</span>
                <small>{usable ? `${eligible} ${eligible === 1 ? 'participante elegible' : 'participantes elegibles'} hoy · ${count} de 3 categorías` : 'No tiene las categorías oficiales: no se puede ensayar con estos registros.'}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div className="rf-chooser-actions">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancelar</Button>}
        <Button disabled={!picked} onClick={() => picked && onChoose(picked)}>Ensayar con estos registros</Button>
      </div>
    </section>
  );
}
