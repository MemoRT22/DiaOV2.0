import { ChevronRight, Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="ad-page-header">
    <div className="ad-page-heading">
      <p className="ad-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="ad-page-description">{description}</p>
    </div>
    {action && <div className="ad-page-action">{action}</div>}
  </header>;
}

export function SectionTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.value === value);
    const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].value);
    (event.currentTarget.querySelectorAll('[role="tab"]')[next] as HTMLElement | undefined)?.focus();
  };
  return <div role="tablist" aria-label={label} className="ad-section-tabs" onKeyDown={onKeyDown}>
    {tabs.map((tab) => <button type="button" role="tab" key={tab.value} aria-selected={tab.value === value}
      tabIndex={tab.value === value ? 0 : -1} className="ad-section-tab" onClick={() => onChange(tab.value)}>{tab.label}</button>)}
  </div>;
}

export function ScopeSwitch<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="ad-scope-switch" role="group" aria-label={label}>
    {options.map((option) => <button type="button" key={option.value} className="ad-scope-option"
      aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function SearchField({ label, value, onChange, placeholder, autoFocus = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean }) {
  return <label className="ad-search">
    <span className="sr-only">{label}</span>
    <Search size={17} aria-hidden />
    <input type="text" inputMode="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
  </label>;
}

export function SectionHeading({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="ad-section-heading">
    <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
    {action && <div className="ad-section-action">{action}</div>}
  </div>;
}

export function EmptyState({ title, description, action }: { title: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="ad-empty"><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function RowAction({ children, onClick, danger = false, disabled = false, label }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; label?: string }) {
  return <button type="button" className="ad-row-action" data-danger={danger || undefined} onClick={onClick} disabled={disabled} aria-label={label}>
    {children}<ChevronRight size={15} aria-hidden />
  </button>;
}

export function DataPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ad-data-panel ${className}`}>{children}</div>;
}
