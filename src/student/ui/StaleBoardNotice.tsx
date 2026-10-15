import { Alert } from '../../components/ui';

/** The last refresh failed but the student keeps the last board they had: places must be verified again before relying on them. */
export default function StaleBoardNotice({ stale, onRetry }: { stale: boolean; onRetry: () => unknown }) {
  if (!stale) return null;
  return (
    <Alert tone="warning">
      No pudimos actualizar los cupos y horarios. Te mostramos lo último que teníamos: verifica la disponibilidad antes de decidir.{' '}
      <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void onRetry()}>Actualizar</button>
    </Alert>
  );
}
