import type { ReactNode } from 'react';
import type { Division } from '../../lib/catalog';
import { ASSET_KEYS, COLOR_KEYS, TEXT_KEYS, VOCABULARY_KEYS, type AssetKey, type ColorKey, type TextKey, type ThemeConfig, type VocabularyKey } from '../../theme/types';

export type Section = 'identidad' | 'colores' | 'vocabulario' | 'rangos' | 'textos' | 'recursos';

const COLOR_LABELS: Record<ColorKey, string> = {
  primary: 'Principal',
  secondary: 'Secundario',
  accent: 'Acento',
  success: 'Éxito',
  warning: 'Advertencia',
  error: 'Error',
  neutral: 'Neutro',
  background: 'Fondo',
  surface: 'Tarjetas',
  surfaceRaised: 'Tarjetas elevadas',
  ink: 'Texto principal',
  inkMuted: 'Texto secundario',
  line: 'Bordes',
};

const VOCAB_LABELS: Record<VocabularyKey, string> = {
  activity: 'Taller',
  division: 'División',
  rank: 'Etapa de progreso',
  passport: 'Pasaporte',
  route: 'Mi ruta',
  stamp: 'Sello',
  interests: 'Intereses posteriores',
};

const TEXT_LABELS: Record<TextKey, string> = {
  navPassport: 'Pestaña: pasaporte',
  navActivities: 'Pestaña: talleres',
  navInterests: 'Pestaña: intereses',
  loginTitle: 'Acceso: título',
  loginSubtitle: 'Acceso: subtítulo',
  loginHelp: 'Acceso: ayuda',
  welcomeTitle: 'Bienvenida: título',
  welcomeBody: 'Bienvenida: mensaje del guía',
  passportIntro: 'Pasaporte: introducción',
  progressNext: 'Progreso: siguiente rango',
  progressMax: 'Progreso: rango máximo',
  activitiesIntro: 'Talleres: introducción',
  activitiesEmpty: 'Talleres: sin resultados',
  interestsPromptTitle: 'Recordatorio de intereses: título',
  interestsPromptBody: 'Recordatorio de intereses: mensaje',
  interestsTitle: 'Intereses: título',
  interestsBody: 'Intereses: instrucciones',
  interestsSaved: 'Intereses: guardado',
  interestsClosed: 'Intereses: cerrado',
  closingTitle: 'Cierre: título',
  closingBody: 'Cierre: mensaje',
};

const ASSET_LABELS: Record<AssetKey, string> = {
  logoMark: 'Logo símbolo',
  logoWordmark: 'Logo con nombre',
  logoSeal: 'Sello institucional',
  logoTagline: 'Lema institucional',
  mascot: 'Guía (mascota)',
};

const MAX_LEN = 600;
const inputCls =
  'w-full rounded-theme border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-secondary-400 focus:outline-none disabled:opacity-60';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

function Text({ value, onChange, area }: { value: string; onChange: (v: string) => void; area?: boolean }) {
  return area ? (
    <textarea className={inputCls} rows={3} maxLength={MAX_LEN} value={value} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className={inputCls} maxLength={MAX_LEN} value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-10 w-12 cursor-pointer rounded-theme border border-line bg-surface p-1"
        aria-label="Elegir color"
      />
      <input className={`${inputCls} font-mono uppercase`} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

type Props = { section: Section; config: ThemeConfig; divisions: Division[]; onChange: (next: ThemeConfig) => void };

export default function ThemeFields({ section, config: c, divisions, onChange }: Props) {
  const set = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) => onChange({ ...c, [key]: value });

  if (section === 'identidad') {
    const meta = (k: keyof ThemeConfig['meta']) => (v: string) => set('meta', { ...c.meta, [k]: v });
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Nombre del evento"><Text value={c.meta.eventName} onChange={meta('eventName')} /></Row>
        <Row label="Etiqueta de edición"><Text value={c.meta.editionLabel} onChange={meta('editionLabel')} /></Row>
        <Row label="Lema"><Text value={c.meta.tagline} onChange={meta('tagline')} /></Row>
        <Row label="Parte destacada del lema" hint="Se muestra dentro de una cápsula de color."><Text value={c.meta.taglineHighlight} onChange={meta('taglineHighlight')} /></Row>
        <Row label="Organiza"><Text value={c.meta.organizer} onChange={meta('organizer')} /></Row>
        <Row label="Nombre del guía"><Text value={c.meta.guideName} onChange={meta('guideName')} /></Row>
        <Row label="Fuente de títulos"><Text value={c.typography.display} onChange={(v) => set('typography', { ...c.typography, display: v })} /></Row>
        <Row label="Fuente de texto"><Text value={c.typography.body} onChange={(v) => set('typography', { ...c.typography, body: v })} /></Row>
      </div>
    );
  }

  if (section === 'colores') {
    const codes = [...new Set([...divisions.map((d) => d.code), ...Object.keys(c.divisions)])];
    const nameOf = (code: string) => divisions.find((d) => d.code === code)?.name ?? code;
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {COLOR_KEYS.map((k) => (
            <Row key={k} label={COLOR_LABELS[k]}>
              <Color value={c.colors[k]} onChange={(v) => set('colors', { ...c.colors, [k]: v })} />
            </Row>
          ))}
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Color por división</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {codes.map((code) => (
              <Row key={code} label={nameOf(code)}>
                <Color
                  value={c.divisions[code]?.color ?? c.colors.secondary}
                  onChange={(v) => set('divisions', { ...c.divisions, [code]: { color: v } })}
                />
              </Row>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (section === 'vocabulario') {
    return (
      <div className="space-y-4">
        {VOCABULARY_KEYS.map((k) => (
          <div key={k} className="grid gap-3 sm:grid-cols-[160px_1fr_1fr] sm:items-end">
            <p className="text-sm font-semibold">{VOCAB_LABELS[k]}</p>
            <Row label="Singular">
              <Text value={c.vocabulary[k].one} onChange={(v) => set('vocabulary', { ...c.vocabulary, [k]: { ...c.vocabulary[k], one: v } })} />
            </Row>
            <Row label="Plural">
              <Text value={c.vocabulary[k].many} onChange={(v) => set('vocabulary', { ...c.vocabulary, [k]: { ...c.vocabulary[k], many: v } })} />
            </Row>
          </div>
        ))}
      </div>
    );
  }

  if (section === 'rangos') {
    const rank = (i: number, k: 'name' | 'description' | 'promotion') => (v: string) =>
      set('ranks', c.ranks.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    return (
      <div className="space-y-6">
        <p className="text-xs text-ink-muted">
          Nombres y mensajes que ve el alumno en cada nivel. Los requisitos para subir de nivel (sellos y divisiones distintas) los define el sistema.
        </p>
        {c.ranks.map((r, i) => (
          <fieldset key={i} className="space-y-3 rounded-theme border border-line p-4">
            <legend className="px-2 text-sm font-semibold">Nivel {i + 1}</legend>
            <Row label="Nombre"><Text value={r.name} onChange={rank(i, 'name')} /></Row>
            <Row label="Descripción"><Text area value={r.description} onChange={rank(i, 'description')} /></Row>
            <Row label="Mensaje al ascender"><Text value={r.promotion} onChange={rank(i, 'promotion')} /></Row>
          </fieldset>
        ))}
      </div>
    );
  }

  if (section === 'textos') {
    return (
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">
          Puedes usar {'{guide}'} para el nombre del guía, {'{event}'} para el nombre del evento y, en los textos de progreso, {'{rank}'} y{' '}
          {'{remaining}'}.
        </p>
        {TEXT_KEYS.map((k) => (
          <Row key={k} label={TEXT_LABELS[k]}>
            <Text area={c.texts[k].length > 60} value={c.texts[k]} onChange={(v) => set('texts', { ...c.texts, [k]: v })} />
          </Row>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {ASSET_KEYS.map((k) => (
          <Row key={k} label={ASSET_LABELS[k]} hint="Ruta que empiece con /assets/ o https://">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-theme border border-line bg-surface-sunken">
                {c.assets[k] && <img src={c.assets[k]} alt="" className="h-full w-full object-contain" />}
              </div>
              <Text value={c.assets[k]} onChange={(v) => set('assets', { ...c.assets, [k]: v })} />
            </div>
          </Row>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Fondo">
          <select
            className={inputCls}
            value={c.style.background}
            onChange={(e) => set('style', { ...c.style, background: e.target.value === 'starfield' ? 'starfield' : 'plain' })}
          >
            <option value="starfield">Campo de estrellas</option>
            <option value="plain">Liso</option>
          </select>
        </Row>
        <Row label={`Redondeo de esquinas (${c.radius} px)`}>
          <input type="range" min={0} max={32} value={c.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full accent-primary-500" />
        </Row>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={c.style.glowRing} onChange={(e) => set('style', { ...c.style, glowRing: e.target.checked })} className="h-5 w-5 accent-primary-500" />
          Anillo luminoso en la portada
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={c.style.metallicTitles} onChange={(e) => set('style', { ...c.style, metallicTitles: e.target.checked })} className="h-5 w-5 accent-primary-500" />
          Títulos con efecto metálico
        </label>
      </div>
    </div>
  );
}
