import { CalendarClock, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '../components/ui';
import { useEdition } from '../edition/EditionProvider';
import { formatDateTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { reservationWindow, updateReservationSettings } from '../lib/reservations';

const CANCUN_OFFSET = '-05:00';

function toCancunInput(iso: string | null) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Cancun',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const fromCancunInput = (value: string) => (value ? `${value}:00${CANCUN_OFFSET}` : null);

const WINDOW_LABELS = { not_open: 'Cerradas (aún no abren)', open: 'Abiertas', closed: 'Cerradas' } as const;

export default function ReservationRules() {
  const { edition, reloadEdition } = useEdition();
  const [openAt, setOpenAt] = useState(toCancunInput(edition?.reservations_open_at ?? null));
  const [closeAt, setCloseAt] = useState(toCancunInput(edition?.reservations_close_at ?? null));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  if (!edition) return <Alert tone="error">{friendlyError('NO_ACTIVE_EDITION')}</Alert>;
  const current = reservationWindow(edition.reservations_open_at, edition.reservations_close_at);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (closeAt && (!openAt || closeAt <= openAt)) {
      setStatus({ tone: 'error', msg: friendlyError('INVALID_WINDOW') });
      return;
    }
    setBusy(true);
    try {
      await updateReservationSettings({
        reservations_open_at: fromCancunInput(openAt),
        reservations_close_at: fromCancunInput(closeAt),
      });
      await reloadEdition();
      setStatus({ tone: 'success', msg: 'Apertura y cierre guardados.' });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Reservaciones</h1>
        <p className="mt-1 text-sm text-ink-muted">Define cuándo pueden reservar los aspirantes. Horas de Cancún.</p>
      </header>

      <div className="card flex items-center gap-3 p-4">
        <CalendarClock className="h-5 w-5 text-fg-info" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">Estado actual: {WINDOW_LABELS[current]}</p>
          <p className="text-ink-muted">
            {edition.reservations_open_at ? `Apertura ${formatDateTime(edition.reservations_open_at)}` : 'Sin fecha de apertura'}
            {edition.reservations_close_at && ` · cierre ${formatDateTime(edition.reservations_close_at)}`}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <Field label="Apertura" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} hint="Vacío: reservaciones cerradas." />
        <Field
          label="Cierre (opcional)"
          type="datetime-local"
          value={closeAt}
          onChange={(e) => setCloseAt(e.target.value)}
          hint="Después del cierre ya no se reserva ni se cambia; sí se puede cancelar antes de que inicie la sesión."
        />
        {status && <Alert tone={status.tone}>{status.msg}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      </form>

      <section aria-label="Reglas del sistema" className="card space-y-3 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-fg-success" aria-hidden />
          <h2 className="font-semibold">Reglas que aplica el sistema</h2>
        </div>
        <p className="text-sm text-ink-muted">No necesitan configuración: el sistema las hace cumplir en cada reservación.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Hasta {edition.max_reservations} talleres activos por aspirante.</li>
          <li>No se permiten talleres que se empalmen; se deja un traslado mínimo de {edition.travel_buffer_minutes} minutos entre sesiones.</li>
          <li>Un mismo taller no se reserva dos veces, ni uno que ya se asistió.</li>
          <li>Cambiar de horario es atómico: si el nuevo no está disponible, el aspirante conserva su lugar actual.</li>
          <li>
            El check-in abre {edition.checkin_open_before_minutes} minutos antes de que termine la sesión y cierra {edition.checkin_close_after_minutes} minutos después.
          </li>
          <li>El cupo de cada sesión nunca se excede, aunque varias personas reserven al mismo tiempo.</li>
        </ul>
      </section>
    </div>
  );
}
