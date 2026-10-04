import { Alert } from '../../components/ui';
import { formatDateTime } from '../../lib/catalog';
import type { Board } from '../../lib/reservations';

export default function WindowNotice({ board }: { board: Board }) {
  if (board.window === 'not_open') {
    return (
      <Alert>
        {board.opens_at ? `Las reservaciones abren el ${formatDateTime(board.opens_at)}.` : 'Las reservaciones aún no abren.'} Mientras, puedes
        conocer los talleres.
      </Alert>
    );
  }
  if (board.window === 'closed') {
    return <Alert tone="warning">Las reservaciones cerraron. Puedes cancelar una sesión que aún no inicie, pero ya no reservar ni cambiar.</Alert>;
  }
  if (board.closes_at) {
    return <Alert>Puedes reservar hasta el {formatDateTime(board.closes_at)}.</Alert>;
  }
  return null;
}
