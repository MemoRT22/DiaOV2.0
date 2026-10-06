import { Download, History, LockKeyhole, ShieldAlert, Unlock, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Alert, Badge, Button, Modal, Spinner } from '../../components/ui';
import { fetchDivisions, formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { useEdition } from '../../edition/EditionProvider';
import { usePublicTheme } from '../../theme/PublicThemeProvider';
import { contrastIssues, normalizeTheme } from '../../theme/themeEngine';
import type { ThemeConfig } from '../../theme/types';
import PhraseConfirmModal from '../PhraseConfirmModal';
import ThemeFields, { type Section } from './ThemeFields';
import ThemePreview from './ThemePreview';

type Version = {
  id: string;
  status: 'draft' | 'published' | 'archived';
  version: number | null;
  config: unknown;
  note: string | null;
  updated_at: string;
  published_at: string | null;
};

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'identidad', label: 'Identidad' },
  { id: 'colores', label: 'Colores' },
  { id: 'vocabulario', label: 'Vocabulario' },
  { id: 'rangos', label: 'Niveles' },
  { id: 'textos', label: 'Textos' },
  { id: 'recursos', label: 'Imágenes y estilo' },
];

const MAX_IMPORT_BYTES = 200_000;

export default function ThemeEditor() {
  const { edition, reloadEdition } = useEdition();
  const { reloadTheme } = usePublicTheme();
  const { data, error, loading, reload } = useLoad(async () => {
    if (!edition) throw new Error('NO_ACTIVE_EDITION');
    const [{ data: rows, error: e }, divisions] = await Promise.all([
      supabase
        .from('theme_versions')
        .select('id, status, version, config, note, updated_at, published_at')
        .eq('edition_id', edition.id)
        .order('created_at', { ascending: false }),
      fetchDivisions(),
    ]);
    if (e) throw e;
    return { versions: (rows ?? []) as Version[], divisions };
  }, [edition?.id]);

  const [config, setConfig] = useState<ThemeConfig | null>(null);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<Section>('identidad');
  const [busy, setBusy] = useState<'save' | 'publish' | 'relock' | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);
  const [modal, setModal] = useState<'unlock' | 'history' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const draft = data?.versions.find((v) => v.status === 'draft');
  const published = data?.versions.find((v) => v.status === 'published');

  useEffect(() => {
    if (!data) return;
    const source = draft ?? published;
    setConfig(normalizeTheme(source?.config));
    setNote(draft?.note ?? '');
    setDirty(false);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = useMemo(() => (config ? contrastIssues(config) : []), [config]);

  if (loading || (data && !config)) return <Spinner />;
  if (error || !data || !config || !edition) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  const unlockUntil = edition.theme_unlock_until ? new Date(edition.theme_unlock_until).getTime() : 0;
  const unlocked = unlockUntil > now;
  const locked = edition.mode === 'operacion_real' && !unlocked;

  const change = (next: ThemeConfig) => {
    setConfig(next);
    setDirty(true);
    setStatus(null);
  };

  const run = async (kind: 'save' | 'publish' | 'relock', action: () => Promise<string>) => {
    setBusy(kind);
    setStatus(null);
    try {
      const msg = await action();
      setStatus({ tone: 'success', msg });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    const { error: e } = await supabase.rpc('save_theme_draft', { p_config: config, p_note: note });
    if (e) throw e;
  };

  const onSave = () =>
    run('save', async () => {
      await saveDraft();
      reload();
      return 'Borrador guardado. Los alumnos aún ven la versión publicada.';
    });

  const onPublish = () =>
    run('publish', async () => {
      await saveDraft();
      const { error: e } = await supabase.rpc('publish_theme_draft');
      if (e) throw e;
      await Promise.all([reloadEdition(), reloadTheme()]);
      reload();
      return 'Temática publicada. Los alumnos ya ven los cambios.';
    });

  const onRelock = () =>
    run('relock', async () => {
      const { error: e } = await supabase.rpc('relock_theme');
      if (e) throw e;
      await reloadEdition();
      return 'La temática volvió a bloquearse.';
    });

  const onRestore = async (id: string) => {
    setModal(null);
    await run('save', async () => {
      const { error: e } = await supabase.rpc('restore_theme_version', { p_version_id: id });
      if (e) throw e;
      reload();
      return 'La versión se cargó como borrador. Revísala y publícala cuando esté lista.';
    });
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tematica-${edition.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setStatus({ tone: 'error', msg: friendlyError(new Error('THEME_TOO_LARGE')) });
    try {
      change(normalizeTheme(JSON.parse(await file.text())));
      setStatus({ tone: 'success', msg: 'Archivo cargado en el editor. Guarda el borrador para conservarlo.' });
    } catch {
      setStatus({ tone: 'error', msg: friendlyError(new Error('INVALID_THEME')) });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Edición y temática</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {published ? `Publicada: versión ${published.version}` : 'Sin versión publicada'}
            {draft && ` · Borrador guardado ${formatDateTime(draft.updated_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setModal('history')}>
            <History className="h-4 w-4" aria-hidden />
            Versiones
          </Button>
          <Button variant="ghost" onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden />
            Exportar
          </Button>
          {!locked && (
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden />
              Importar
            </Button>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImport} />
        </div>
      </header>

      {locked && (
        <Alert tone="warning">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden />
              La temática está bloqueada porque el evento está en operación real. Solo puedes consultarla.
            </p>
            <Button variant="secondary" onClick={() => setModal('unlock')}>
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Desbloqueo de emergencia
            </Button>
          </div>
        </Alert>
      )}
      {edition.mode === 'operacion_real' && unlocked && (
        <Alert tone="error">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2">
              <Unlock className="h-4 w-4 shrink-0" aria-hidden />
              Desbloqueo de emergencia activo hasta {formatDateTime(edition.theme_unlock_until!)}. Los cambios publicados se ven de inmediato.
            </p>
            <Button variant="secondary" onClick={onRelock} loading={busy === 'relock'}>
              Volver a bloquear
            </Button>
          </div>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card p-0">
          <div className="flex gap-1 overflow-x-auto border-b border-line p-2" role="tablist">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                onClick={() => setSection(s.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  section === s.id ? 'bg-primary-500/15 text-fg-brand' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <fieldset disabled={locked} className="p-5">
            <ThemeFields section={section} config={config} divisions={data.divisions} onChange={change} />
          </fieldset>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Vista previa</p>
          <ThemePreview config={config} />
          {issues.length > 0 ? (
            <Alert tone="warning">
              <p className="font-semibold">Revisa la legibilidad:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {issues.map((i) => (
                  <li key={i.label}>
                    {i.label}: {i.ratio.toFixed(1)}:1 (mínimo {i.required}:1)
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">Los colores tienen buen contraste.</Alert>
          )}
        </aside>
      </div>

      {!locked && (
        <section className="card space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">Nota de esta versión (opcional)</span>
            <input
              className="w-full rounded-theme border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-secondary-400 focus:outline-none"
              maxLength={500}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {status && <Alert tone={status.tone}>{status.msg}</Alert>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onSave} loading={busy === 'save'} disabled={!dirty || !!busy}>
              {dirty ? 'Guardar borrador' : 'Sin cambios'}
            </Button>
            <Button onClick={onPublish} loading={busy === 'publish'} disabled={!!busy || (!dirty && !draft)}>
              Publicar
            </Button>
          </div>
        </section>
      )}
      {locked && status && <Alert tone={status.tone}>{status.msg}</Alert>}

      {modal === 'history' && (
        <Modal title="Versiones de la temática" onClose={() => setModal(null)}>
          <ul className="space-y-2">
            {data.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 rounded-theme border border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{v.status === 'draft' ? 'Borrador' : `Versión ${v.version}`}</span>
                    {v.status === 'published' && <Badge tone="success">Publicada</Badge>}
                  </div>
                  <p className="truncate text-xs text-ink-muted">
                    {formatDateTime(v.published_at ?? v.updated_at)}
                    {v.note ? ` · ${v.note}` : ''}
                  </p>
                </div>
                {v.status !== 'draft' && !locked && (
                  <Button variant="secondary" className="min-h-10 px-4" onClick={() => onRestore(v.id)}>
                    Restaurar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {modal === 'unlock' && (
        <PhraseConfirmModal
          title="Desbloqueo de emergencia"
          phrase="DESBLOQUEAR TEMÁTICA"
          confirmLabel="Desbloquear 30 minutos"
          danger
          withReason
          onClose={() => setModal(null)}
          onConfirm={async (phrase, reason) => {
            const { error: e } = await supabase.rpc('emergency_unlock_theme', { p_phrase: phrase, p_reason: reason });
            if (e) throw e;
            await reloadEdition();
            setNow(Date.now());
            setModal(null);
          }}
        >
          <p>Úsalo solo para corregir un error visible durante el evento. La temática se desbloquea por 30 minutos y la acción queda registrada con tu nombre y el motivo.</p>
        </PhraseConfirmModal>
      )}
    </div>
  );
}
