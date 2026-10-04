import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Field, Modal } from '../components/ui';
import { friendlyError } from '../lib/errors';

type Props = {
  title: string;
  phrase: string;
  confirmLabel: string;
  danger?: boolean;
  withReason?: boolean;
  children: ReactNode;
  onClose: () => void;
  onConfirm: (phrase: string, reason: string) => Promise<void>;
};

export default function PhraseConfirmModal({ title, phrase, confirmLabel, danger, withReason, children, onClose, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = typed.trim() === phrase && (!withReason || reason.trim().length >= 10);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(typed.trim(), reason.trim());
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-3 text-sm text-ink-muted">{children}</div>
        {withReason && (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Motivo (mínimo 10 caracteres)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-theme border border-line bg-surface px-4 py-3 text-sm text-ink focus:border-secondary-400 focus:outline-none"
            />
          </label>
        )}
        <Field
          label={`Escribe "${phrase}" para confirmar`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ready} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
