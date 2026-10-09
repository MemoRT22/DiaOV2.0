import { Lock } from 'lucide-react';
import type { Division } from '../lib/catalog';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { divisionColor, divisionIcon, tintVars } from './ui/divisionVisuals';

/**
 * The stamp collection of the Bitácora: one ink stamp per division. Collected = coloured double-ring stamp, slightly
 * rotated, as if pressed by hand; pending = faint dashed silhouette with a lock. State is never carried by colour alone
 * (shape, icon and an accessible label all differ). `compact` renders a single scrollable strip.
 */
export default function StampCollection({ divisions, visited, compact = false }: { divisions: Division[]; visited: Set<string>; compact?: boolean }) {
  const { theme, term } = usePublicTheme();
  const unit = term('division', true).toLowerCase();

  const stamp = (d: Division, i: number) => {
    const on = visited.has(d.id);
    const Icon = divisionIcon(d.name);
    const tilt = [-6, 4, -3, 7, -5, 3][i % 6];
    return (
      <li
        key={d.id}
        aria-label={`${d.name}: ${on ? 'conseguido' : 'pendiente'}`}
        className={`flex shrink-0 flex-col items-center gap-2 text-center ${compact ? 'w-[4.5rem]' : ''}`}
      >
        <span
          className={`relative flex items-center justify-center rounded-full ${compact ? 'h-14 w-14' : 'h-[4.75rem] w-[4.75rem]'} ${
            on ? 'ink-stamp anim-stamp' : 'border-2 border-dashed border-line text-ink-muted'
          }`}
          style={on ? { ...tintVars(divisionColor(theme, d)), animationDelay: `${i * 80}ms`, rotate: `${tilt}deg` } : undefined}
        >
          <Icon className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} ${on ? '' : 'opacity-35'}`} aria-hidden />
          {!on && (
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-sunken bg-surface-raised text-ink-muted" aria-hidden>
              <Lock className="h-3 w-3" />
            </span>
          )}
        </span>
        <span className={`line-clamp-2 text-[11px] font-semibold leading-tight ${on ? 'text-ink' : 'text-ink-muted'}`}>{d.name}</span>
      </li>
    );
  };

  return (
    <div>
      <p className="sr-only">
        {visited.size} de {divisions.length} {unit} conseguidas
      </p>
      <ul className={compact ? 'no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1' : 'grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4'}>
        {divisions.map(stamp)}
      </ul>
    </div>
  );
}
