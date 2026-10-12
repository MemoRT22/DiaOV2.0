import { ArrowUpRight, GraduationCap, Palette, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SETTINGS_SECTIONS } from './navigation';

const GROUPS = [...new Set(SETTINGS_SECTIONS.map((section) => section.group))];
const SECTION_ICONS = [UsersRound, Palette, GraduationCap];

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
            {SETTINGS_SECTIONS.filter((section) => section.group === group).map(({ to, label, description }) => {
              const Icon = SECTION_ICONS[SETTINGS_SECTIONS.findIndex((section) => section.to === to)] ?? GraduationCap;
              return (
              <Link
                key={to}
                to={to}
                className="admin-feature-card group flex min-h-36 items-start gap-4 p-5"
              >
                <span className="admin-feature-icon shrink-0"><Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold">{label}</span>
                  <span className="mt-1 block text-sm text-ink-muted">{description}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-info" aria-hidden />
              </Link>
            ); })}
          </div>
        </section>
      ))}
    </div>
  );
}
