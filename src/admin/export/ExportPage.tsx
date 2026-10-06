import { ArrowLeft, FileSpreadsheet, ListChecks, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { friendlyError } from '../../lib/errors';
import { useEdition } from '../../edition/EditionProvider';
import { buildVocationalWorkbook, type VocationalExportPayload } from './buildVocationalWorkbook';
import { buildWorkbook, type ExportPayload } from './buildWorkbook';

export default function ExportPage() {
  const { edition } = useEdition();
  const [reason, setReason] = useState('Entrega a Atención Preuniversitaria');
  const [includeDemo, setIncludeDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const [vocBusy, setVocBusy] = useState(false);
  const [vocError, setVocError] = useState('');
  const [vocDone, setVocDone] = useState<number | null>(null);
  const preparing = edition?.mode === 'preparacion';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const demo = preparing && includeDemo;
      const payload = await rpc<ExportPayload>('export_participants', { p_reason: reason.trim(), p_include_demo: demo });
      if (!payload || !Array.isArray(payload.rows)) throw new Error('SERVER_ERROR');
      const blob = await buildWorkbook(payload, reason.trim(), demo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `participantes-${payload.edition_code}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(payload.count);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitInterests = async (e: FormEvent) => {
    e.preventDefault();
    setVocBusy(true);
    setVocError('');
    setVocDone(null);
    try {
      const demo = preparing && includeDemo;
      const payload = await rpc<VocationalExportPayload>('export_vocational', { p_reason: reason.trim(), p_include_demo: demo });
      if (!payload || !Array.isArray(payload.rows)) throw new Error('SERVER_ERROR');
      const blob = await buildVocationalWorkbook(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `intereses-asistencias-${payload.edition_code}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setVocDone(payload.count);
    } catch (cause) {
      setVocError(friendlyError(cause));
    } finally {
      setVocBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Participantes
      </Link>
      <header>
        <h1 className="text-2xl font-extrabold">Exportación para Atención Preuniversitaria</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Descarga un Excel con un renglón por aspirante: datos de contacto, carrera inicial, intereses posteriores, asistencias y consentimientos.
        </p>
      </header>

      <div className="card flex gap-3 p-5 text-sm text-ink-muted">
        <ShieldCheck className="h-5 w-5 shrink-0 text-fg-info" aria-hidden />
        <p>
          El archivo se genera en este momento y no se guarda en ningún servidor. Queda registrado en la auditoría quién lo generó y el motivo.
          Contiene datos personales: compártelo solo por los canales autorizados.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-5 p-6">
        <Field
          label="Motivo de la exportación"
          hint="Obligatorio. Se guarda en la auditoría y en la hoja Información."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={300}
          required
        />
        {preparing && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary-500" />
            <span>
              Incluir datos de prueba
              <span className="block text-xs text-ink-muted">Útil para revisar el formato antes del evento. Se marcan en una columna aparte.</span>
            </span>
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {done !== null && (
          <Alert tone="success">
            Listo. Se descargó el archivo con {done} participante{done === 1 ? '' : 's'}.
          </Alert>
        )}
        <Button type="submit" loading={busy}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          {busy ? 'Generando…' : 'Generar Excel'}
        </Button>
      </form>

      <div className="card space-y-5 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <ListChecks className="h-5 w-5 text-fg-brand" aria-hidden />
            Intereses y asistencias
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Descarga un Excel con el resumen de cada aspirante: interés inicial, opciones posteriores, talleres
            asistidos y divisiones visitadas.
          </p>
        </div>
        {vocError && <Alert tone="error">{vocError}</Alert>}
        {vocDone !== null && (
          <Alert tone="success">
            Listo. Se descargó el archivo con {vocDone} participante{vocDone === 1 ? '' : 's'}.
          </Alert>
        )}
        <Button onClick={submitInterests} loading={vocBusy} variant="secondary">
          <ListChecks className="h-4 w-4" aria-hidden />
          {vocBusy ? 'Generando…' : 'Generar Excel de intereses'}
        </Button>
      </div>
    </div>
  );
}
