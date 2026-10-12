import { useState } from 'react';
import { Alert, Button, Field, Modal } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { invalidateWinner } from '../../lib/raffleApi';

/** What the dialog needs to name the result it invalidates; both the history rows and the draw screen provide it. */
export type InvalidatableWinner = { id: string; prize_name: string; display_name: string };

export function InvalidateModal({ winner, onClose, onDone }: { winner: InvalidatableWinner; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await invalidateWinner(winner.id, reason.trim()); onDone(); }
    catch (cause) { setError(friendlyError(cause)); setBusy(false); }
  };
  return (
    <Modal title="Invalidar ganador" onClose={onClose}>
      <form onSubmit={submit} className="ad-modal-form space-y-4">
        <Alert tone="warning">Vas a invalidar el premio <strong>{winner.prize_name}</strong> de <strong>{winner.display_name}</strong>. El inventario se restaurará y el participante volverá al pool. Esta acción queda registrada en auditoría y no se puede deshacer.</Alert>
        <Field label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="secondary" loading={busy}>Invalidar</Button></div>
      </form>
    </Modal>
  );
}
