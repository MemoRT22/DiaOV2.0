import { Link } from 'react-router-dom';
import { Alert, Button, Spinner } from '../components/ui';
import { formatDateTime, formatEventDate } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';

type Summary = {
  participants_total: number;
  participants_forms: number;
  participants_manual: number;
  participants_demo: number;
  platform_consents: number;
  activities: number;
  sessions: number;
  attendances: number;
  with_interests: number;
  theme_locked: boolean;
  missing_birth_date: number;
  pending_conflicts: number;
};

export default function Overview() {
  const { edition } = useTheme();
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.rpc('coordination_summary');
    if (e) throw e;
    if (!s || typeof s.participants_total !== 'number') throw new Error('INVALID_SUMMARY');
    return s as Summary;
  }, []);

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  const stats = [
    { label: 'Participantes', value: data.participants_total, hint: `${data.participants_forms} de Forms · ${data.participants_manual} altas manuales` },
    { label: 'Aceptaron el aviso en la plataforma', value: data.platform_consents },
    { label: 'Talleres', value: data.activities, hint: `${data.sessions} horarios` },
    { label: 'Asistencias registradas', value: data.attendances },
    { label: 'Con intereses posteriores', value: data.with_interests },
    { label: 'Participantes de prueba', value: data.participants_demo },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Resumen</h1>
        {edition && (
          <p className="mt-1 text-sm text-ink-muted">
            {edition.name} · {formatEventDate(edition.event_date)} · {edition.start_time} h · {edition.venue}
          </p>
        )}
      </header>

      {edition?.mode === 'preparacion' ? (
        <Alert tone="warning">
          El sistema está en preparación. Puedes probar con datos de prueba y editar la temática. Antes del evento, retira los datos de
          prueba y activa la operación real.
        </Alert>
      ) : (
        <Alert tone="success">
          Operación real activa desde {edition?.real_operation_at ? formatDateTime(edition.real_operation_at) : '—'}. La temática y la
          limpieza de datos de prueba están bloqueadas.
        </Alert>
      )}

      {data.pending_conflicts > 0 && (
        <Alert tone="warning">
          Hay {data.pending_conflicts} conflicto(s) de importación por revisar.{' '}
          <Link to="conflictos" className="font-semibold underline">
            Resolver
          </Link>
        </Alert>
      )}
      {data.missing_birth_date > 0 && (
        <Alert tone="warning">
          {data.missing_birth_date} participante(s) no tienen fecha de nacimiento y no podrán entrar a la plataforma hasta que se corrija.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <p className="text-sm text-ink-muted">{s.label}</p>
            <p className="mt-2 font-display text-3xl font-extrabold">{s.value}</p>
            {s.hint && <p className="mt-1 text-xs text-ink-muted">{s.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
