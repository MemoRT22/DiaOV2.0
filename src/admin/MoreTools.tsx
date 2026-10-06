import { ArrowUpRight, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COORD_MORE } from './navigation';

export default function MoreTools() {
  return <div className="space-y-8">
    <header className="space-y-3">
      <Link to="/coordinacion" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />Volver a Inicio
      </Link>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-500">Coordinación</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Más herramientas</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">Encuentra aquí las tareas de apoyo y la configuración del evento.</p>
      </div>
    </header>
    {COORD_MORE.map(({ title, description, items }) => <section key={title} aria-label={title} className="space-y-4">
      <div><h2 className="text-lg font-bold">{title}</h2><p className="text-sm text-ink-muted">{description}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(({ to, label, icon: Icon, description: detail }) => <Link key={to} to={to}
          className="card group flex min-h-24 items-start gap-4 p-4 transition-colors hover:border-secondary-400 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-theme bg-primary-500/10 text-primary-500">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span>
            <span className="mt-1 block text-sm text-ink-muted">{detail}</span></span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
        </Link>)}
      </div>
    </section>)}
  </div>;
}
