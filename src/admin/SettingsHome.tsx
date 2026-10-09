import { Link } from 'react-router-dom';
import { SETTINGS_SECTIONS } from './navigation';

const GROUPS = [...new Set(SETTINGS_SECTIONS.map((section) => section.group))];

export default function SettingsHome() {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Coordinación</p>
        <h1 className="mt-2">Configuración</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Herramientas para administrar el equipo, la experiencia del alumno y los datos académicos.
        </p>
      </header>
      {GROUPS.map((group) => (
        <section key={group} aria-label={group} className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SETTINGS_SECTIONS.filter((section) => section.group === group).map(({ to, label, description }) => (
              <Link
                key={to}
                to={to}
                className="card group flex min-h-24 items-start gap-4 p-5 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-1 block text-sm text-ink-muted">{description}</span>
                </span>
                <span className="text-xs font-semibold text-fg-brand" aria-hidden>Abrir</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
