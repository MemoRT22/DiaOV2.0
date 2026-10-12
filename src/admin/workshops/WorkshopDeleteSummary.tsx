import type { WorkshopDependents } from '../../lib/workshopAdminApi';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What goes away with a workshop, so the confirmation is explicit about related data (counts come from the server). */
export default function WorkshopDeleteSummary({ title, published, dependents: d }: { title: string; published: boolean; dependents: WorkshopDependents }) {
  const related = d.reservations + d.attendances > 0;
  return (
    <>
      <p>Vas a eliminar definitivamente <strong className="text-ink">{title}</strong>. Esta acción no se puede deshacer.</p>
      {published ? (
        <>
          <p>Dejará de aparecer para los alumnos de inmediato. Junto con el taller se eliminan:</p>
          <ul className="list-disc space-y-1 pl-5" aria-label="Datos que se eliminarán">
            <li>{plural(d.sessions, 'horario', 'horarios')} y su código QR de asistencia</li>
            <li>{plural(d.reservations, 'reservación', 'reservaciones')}</li>
            <li>{plural(d.attendances, 'asistencia registrada', 'asistencias registradas')}, con los sellos que otorgaron</li>
          </ul>
          {related && <p className="font-semibold text-fg-warning">{plural(d.participants, 'alumno perderá', 'alumnos perderán')} su reservación o sus sellos de este taller.</p>}
        </>
      ) : (
        <p>El taller no está publicado: no tiene horarios, reservaciones ni asistencias.</p>
      )}
    </>
  );
}
