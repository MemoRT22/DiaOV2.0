import { useEffect, useState } from 'react';
import { Alert, Badge, Button, LoadError, Spinner } from '../../components/ui';
import { EVENT_TIME_ZONE, formatEventDateTime } from '../../lib/eventTime';
import { friendlyError } from '../../lib/errors';
import {
  AREA_OPTIONS, fetchExitSurveyAdmin, nps, NO_AREA, Q1_OPTIONS, Q3_OPTIONS, setExitSurveyOpensAt, type ExitSurveyAdmin, type SurveyAggregate,
} from '../../lib/exitSurvey';
import { useLoad } from '../../lib/useLoad';
import { DataPanel } from '../design/Primitives';

/** Cancún no tiene horario de verano: UTC−5 todo el año. El campo se captura y se muestra en hora de Cancún, no del dispositivo. */
const CANCUN_OFFSET = '-05:00';
const toInput = (iso: string) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 16);
const fromInput = (value: string) => new Date(`${value}:00${CANCUN_OFFSET}`).toISOString();

const share = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

function Distribution({ title, options, counts, total }: { title: string; options: { value: string; label: string }[]; counts: Record<string, number>; total: number }) {
  return (
    <div className="es-dist">
      <h4>{title}</h4>
      <ul>
        {options.map((option) => (
          <li key={option.value}>
            <span>{option.label}</span>
            <meter min={0} max={Math.max(total, 1)} value={counts[option.value] ?? 0} aria-label={`${option.label}: ${counts[option.value] ?? 0}`} />
            <strong>{counts[option.value] ?? 0} <small>({share(counts[option.value] ?? 0, total)} %)</small></strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Results({ title, data, note }: { title: string; data: SurveyAggregate; note?: string }) {
  const score = nps(data);
  return (
    <DataPanel className="es-results">
      <div className="es-head">
        <h3>{title}</h3>
        <span>{data.completed} de {data.participants} {data.participants === 1 ? 'participante' : 'participantes'} ({share(data.completed, data.participants)} %)</span>
      </div>
      {note && <p className="es-note">{note}</p>}
      {data.completed === 0 ? <p className="es-note">Todavía no hay respuestas.</p> : (
        <>
          <div className="rf-stats" aria-label={`Resumen de ${title}`}>
            <div><strong>{data.q2_average ?? '—'}</strong><span>estrellas en promedio (talleres)</span></div>
            <div><strong>{data.q5_average ?? '—'}</strong><span>recomendación promedio (0–10)</span></div>
            <div><strong>{score ?? '—'}</strong><span>NPS · {data.q5_promoters} promotores, {data.q5_detractors} detractores</span></div>
          </div>
          <Distribution title="Antes de venir, ¿ya sabías qué querías estudiar?" options={Q1_OPTIONS} counts={data.q1} total={data.completed} />
          <Distribution title="Después del Día OV, ¿qué tan claro tienes qué estudiar?" options={Q3_OPTIONS} counts={data.q3} total={data.completed} />
          <Distribution title="Áreas que más interesaron (hasta tres por persona)" options={[...AREA_OPTIONS, { value: NO_AREA, label: 'Todavía sin un área definida' }]} counts={data.q4} total={data.completed} />
          <div className="es-dist">
            <h4>Comentarios: ¿qué mejorarías? ({data.comments.length})</h4>
            {data.comments.length === 0 ? <p className="es-note">Sin comentarios.</p> : (
              <ul className="es-comments">{data.comments.map((comment, index) => <li key={index}>{comment.text}</li>)}</ul>
            )}
          </div>
        </>
      )}
    </DataPanel>
  );
}

/**
 * Encuesta de salida para Coordinación: la hora de apertura (se puede ajustar sin tocar código) y los resultados agregados. Las
 * respuestas no se asocian a personas en esta pantalla; el ensayo y la operación oficial se muestran por separado.
 */
export default function ExitSurveyAdminPanel() {
  const { data, error, loading, reload } = useLoad<ExitSurveyAdmin>(fetchExitSurveyAdmin, []);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { if (data) setValue(toInput(data.opens_at)); }, [data]);
  if (loading && !data) return <Spinner />;
  if (!data) return <LoadError error={error} onRetry={reload} />;

  const save = async (next: string | null) => {
    setSaving(true);
    setMessage(null);
    try {
      await setExitSurveyOpensAt(next);
      setMessage({ tone: 'success', text: next ? 'Hora de apertura actualizada.' : 'Se restableció la hora por omisión (día del evento, 13:00).' });
      reload();
    } catch (cause) {
      setMessage({ tone: 'error', text: friendlyError(cause) });
    } finally {
      setSaving(false);
    }
  };
  const changed = value !== '' && value !== toInput(data.opens_at);
  const rehearsal = data.mode === 'preparacion';

  return (
    <div className="ad-page es-admin">
      <DataPanel className="es-config">
        <div className="es-head">
          <h3>Hora de apertura</h3>
          <Badge tone={data.custom ? 'warning' : 'neutral'}>{data.custom ? 'Ajustada por Coordinación' : 'Por omisión'}</Badge>
        </div>
        <p className="es-note">
          La encuesta se abre para los alumnos el <strong>{formatEventDateTime(data.opens_at)}</strong> (hora de Cancún). La hora la valida el servidor: antes
          de ella nadie —ni con la pantalla abierta— puede enviarla. Las cuentas de prueba pueden probarla en cualquier momento durante el ensayo.
        </p>
        <form className="es-form" onSubmit={(event) => { event.preventDefault(); if (changed && !saving) void save(fromInput(value)); }}>
          <label>
            <span>Nueva hora de apertura ({EVENT_TIME_ZONE})</span>
            <input type="datetime-local" value={value} onChange={(event) => { setValue(event.target.value); setMessage(null); }} required />
          </label>
          <Button type="submit" disabled={!changed} loading={saving}>Guardar hora</Button>
          {data.custom && <Button type="button" variant="secondary" disabled={saving} onClick={() => void save(null)}>Restablecer a las 13:00</Button>}
        </form>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <p className="es-note">Requisito del sorteo: solo entran quienes tienen los sellos de una categoría <strong>y</strong> completaron esta encuesta.</p>
      </DataPanel>
      <Results title="Operación oficial" data={data.official} note={rehearsal ? 'Antes de la operación real no hay participantes oficiales con respuestas.' : undefined} />
      <Results title="Ensayo (cuentas de prueba)" data={data.rehearsal} note="Se borran con la limpieza de la preparación y nunca se mezclan con las oficiales." />
    </div>
  );
}
