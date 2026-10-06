import { Check, Lock } from 'lucide-react';
import { Backdrop, ProgressRing, Tagline, ThemedTitle } from '../../components/themed';
import { PublicThemeScope, usePublicTheme } from '../../theme/PublicThemeProvider';
import type { ThemeConfig } from '../../theme/types';

function PreviewBody() {
  const { theme, term, text, rankName } = usePublicTheme();
  const divisionColors = Object.values(theme.divisions).slice(0, 6);
  return (
    <div className="relative space-y-4 p-5 font-body text-ink">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">{theme.meta.editionLabel}</p>
        <ThemedTitle className="block font-display text-3xl font-extrabold">{theme.meta.eventName}</ThemedTitle>
        <Tagline className="mt-1 text-sm" />
      </div>

      <div className="card flex items-center gap-4 p-4">
        <ProgressRing value={3 / 5} size={88} stroke={8}>
          <span className="font-display text-xl font-extrabold">3</span>
        </ProgressRing>
        <div>
          <p className="text-xs text-ink-muted">{term('rank')}</p>
          <p className="font-display text-base font-extrabold">{rankName(3)}</p>
          <p className="text-xs text-ink-muted">{theme.ranks[2].description}</p>
        </div>
      </div>

      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold text-ink-muted">{term('stamp', true)}</p>
        <div className="grid grid-cols-6 gap-2">
          {(divisionColors.length ? divisionColors : [{ color: theme.colors.secondary }]).map((d, i) => (
            <span
              key={i}
              className="flex aspect-square items-center justify-center rounded-full border-2"
              style={{ borderColor: d.color, background: i < 3 ? d.color : 'transparent' }}
            >
              {i < 3 ? <Check className="h-3 w-3 text-surface-sunken" /> : <Lock className="h-3 w-3 text-ink-muted" />}
            </span>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="h-1 bg-secondary-500" />
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary-300">{term('division')}</p>
          <p className="font-display text-sm font-extrabold">{term('activity')} de ejemplo</p>
          <p className="mt-1 text-xs text-ink-muted">{text('activitiesIntro')}</p>
        </div>
      </div>

      {theme.assets.mascot && (
        <div className="flex items-end gap-3">
          <img src={theme.assets.mascot} alt="" className="h-16 w-16 object-contain" />
          <p className="card flex-1 p-3 text-xs">{text('welcomeTitle')}</p>
        </div>
      )}

      <div className="flex gap-2">
        <span className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-primary-500 text-xs font-semibold text-on-primary">
          Botón principal
        </span>
        <span className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-line bg-surface-raised text-xs font-semibold">
          Secundario
        </span>
      </div>
    </div>
  );
}

export default function ThemePreview({ config }: { config: ThemeConfig }) {
  return (
    <PublicThemeScope theme={config} className="relative overflow-hidden rounded-[28px] border border-line bg-surface-sunken shadow-2xl">
      <Backdrop />
      <PreviewBody />
    </PublicThemeScope>
  );
}
