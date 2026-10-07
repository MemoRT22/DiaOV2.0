import { Award, Briefcase, Check, Flag, HeartPulse, Lock, Palette, Plane, Scale, type LucideIcon } from 'lucide-react';
import type { Division } from '../lib/catalog';
import { usePublicTheme } from '../theme/PublicThemeProvider';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A recognisable symbol per division (by name), so two divisions never look alike. Falls back to a generic award. */
function divisionIcon(name: string): LucideIcon {
  const n = norm(name);
  if (/salud|medic|nutri/.test(n)) return HeartPulse;
  if (/creativ|diseno|arte|comunic/.test(n)) return Palette;
  if (/negocio|empresa|financ/.test(n)) return Briefcase;
  if (/jurid|social|derecho/.test(n)) return Scale;
  if (/lider|deporte/.test(n)) return Flag;
  if (/turism|hoteler|gastron/.test(n)) return Plane;
  return Award;
}

/**
 * The stamp collection. Collected = filled, coloured, with a check; pending = dashed silhouette with a lock.
 * State is never carried by colour alone (shape, icon and an accessible label all differ).
 * `compact` renders a single scrollable strip for Inicio; the default is the full grid for Pasaporte.
 */
export default function StampCollection({ divisions, visited, compact = false }: { divisions: Division[]; visited: Set<string>; compact?: boolean }) {
  const { theme, term } = usePublicTheme();
  const unit = term('division', true).toLowerCase();

  const stamp = (d: Division, i: number) => {
    const on = visited.has(d.id);
    const color = theme.divisions[d.code]?.color ?? theme.colors.secondary;
    const Icon = divisionIcon(d.name);
    return (
      <li
        key={d.id}
        aria-label={`${d.name}: ${on ? 'conseguido' : 'pendiente'}`}
        className={`flex shrink-0 flex-col items-center gap-1.5 text-center ${compact ? 'w-[4.5rem]' : ''}`}
      >
        <span
          className={`relative flex items-center justify-center rounded-full ${compact ? 'h-14 w-14' : 'h-[4.5rem] w-[4.5rem]'} ${
            on ? 'anim-stamp border-2 text-white shadow-lg' : 'border-2 border-dashed border-line text-ink-muted'
          }`}
          style={on ? { background: color, borderColor: color, animationDelay: `${i * 70}ms` } : undefined}
        >
          <Icon className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} ${on ? '' : 'opacity-40'}`} aria-hidden />
          <span
            className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-sunken ${
              on ? 'bg-success-500 text-white' : 'bg-surface-raised text-ink-muted'
            }`}
            aria-hidden
          >
            {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Lock className="h-3 w-3" />}
          </span>
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
