import { CalendarClock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '../components/ui';
import { formatDateTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { reservationWindow, updateReservationSettings } from '../lib/reservations';
import { useTheme } from '../theme/ThemeProvider';

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
  const { edition, reloadEdition } = useTheme();
  const [openAt, setOpenAt] = useState(toCancunInput(edition?.reservations_open_at ?? null));
  const [closeAt, setCloseAt] = useState(toCancunInput(edition?.reservations_close_at ?? null));
  const [max, setMax] = useState(String(edition?.max_reservations ?? 4));
  const [buffer, setBuffer] = useState(String(edition?.travel_buffer_minutes ?? 10));
  const [checkinOpen, setCheckinOpen] = useState(String(edition?.checkin_open_before_minutes ?? 5));
  const [checkinClose, setCheckinClose] = useState(String(edition?.checkin_close_after_minutes ?? 20));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  if (!edition) return <Alert tone="error">{friendlyError('NO_ACTIVE_EDITION')}</Alert>;
  const current = reservationWindow(edition.reservations_open_at, edition.reservations_close_at);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await updateReservationSettings({
        reservations_open_at: fromCancunInput(openAt),
        reservations_close_at: fromCancunInput(closeAt),
        max_reservations: Number(max),
        travel_buffer_minutes: Number(buffer),
        checkin_open_before_minutes: Number(checkinOpen),
        checkin_close_after_minutes: Number(checkinClose),
      });
      await reloadEdition();
      setStatus({ tone: 'success', msg: 'Reglas de reservación guardadas.' });
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
        <p className="mt-1 text-sm text-ink-muted">Reglas con las que los aspirantes arman su ruta antes del evento. Horas de Cancún.</p>
      </header>

      <div className="card flex items-center gap-3 p-4">
        <CalendarClock className="h-5 w-5 text-secondary-300" aria-hidden />
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Máximo de talleres" type="number" min={1} max={20} value={max} onChange={(e) => setMax(e.target.value)} required />
          <Field
            label="Traslado (min)"
            type="number"
            min={0}
            max={120}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            hint="Tiempo mínimo entre sesiones."
            required
          />
        </div>
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold">Check-in (asistencia)</p>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Abrar antes del final (min)"
              type="number"
              min={0}
              max={120}
              value={checkinOpen}
              onChange={(e) => setCheckinOpen(e.target.value)}
              hint="Minutos antes del fin para permitir escanear."
              required
            />
            <Field
              label="Cerrar después del final (min)"
              type="number"
              min={0}
              max={120}
              value={checkinClose}
              onChange={(e) => setCheckinClose(e.target.value)}
              hint="Minutos después del fin para dejar de aceptar."
              required
            />
          </div>
        </div>
        {status && <Alert tone={status.tone}>{status.msg}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      </form>
      <p className="text-xs text-ink-muted">
        Los cambios aplican a nuevas operaciones. Las reservaciones existentes no se modifican aunque bajes el máximo o subas el traslado.
      </p>
    </div>
  );
}
