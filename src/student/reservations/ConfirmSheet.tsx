import { useState } from 'react';
import { Alert, Button, Modal } from '../../components/ui';
import { friendlyError } from '../../lib/errors';

export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** Non-blocking notice shown inside the same dialog (e.g. a tight transfer). */
  warning?: string;
  action: () => Promise<unknown>;
};

export default function ConfirmSheet({ request, onClose }: { request: ConfirmRequest; onClose: (done: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await request.action();
      onClose(true);
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  return (
    <Modal title={request.title} onClose={() => !busy && onClose(false)}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">{request.body}</p>
        {request.warning && !error && <Alert tone="warning">{request.warning}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={() => onClose(false)}>
            {error ? 'Cerrar' : 'Volver'}
          </Button>
          {!error && (
            <Button variant={request.danger ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
              {request.confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
