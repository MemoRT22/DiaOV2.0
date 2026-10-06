import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SETTINGS_SECTIONS } from './navigation';

const GROUPS = [...new Set(SETTINGS_SECTIONS.map((section) => section.group))];

export default function SettingsHome() {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fg-brand">Coordinación</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Configuración</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Solo lo que Coordinación necesita decidir. Las reglas estables del evento las define el sistema.
        </p>
      </header>
      {GROUPS.map((group) => (
        <section key={group} aria-label={group} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SETTINGS_SECTIONS.filter((section) => section.group === group).map(({ to, label, description, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="card group flex min-h-24 items-start gap-4 p-4 transition-colors hover:border-secondary-400 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500/15 to-secondary-500/15 text-fg-brand">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{label}</span>
                  <span className="mt-1 block text-sm text-ink-muted">{description}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
