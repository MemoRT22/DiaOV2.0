import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';

export default function Welcome() {
  const { theme, edition, text } = useTheme();
  const { profile, refreshIdentity } = useAuth();
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const onAccept = async () => {
    setSaving(true);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('accept_platform_notice');
      if (rpcError) throw rpcError;
      await refreshIdentity();
      navigate('/bitacora', { replace: true });
    } catch (cause) {
      setError(friendlyError(cause));
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-end gap-4">
        {theme.assets.mascot && (
          <img src={theme.assets.mascot} alt={theme.meta.guideName} className="h-40 w-auto shrink-0 drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]" />
        )}
        <div className="card relative mb-6 bg-surface-raised p-4">
          <h1 className="text-xl font-extrabold">{text('welcomeTitle', { name: profile?.display_name ?? '' })}</h1>
          <p className="mt-2 text-sm text-ink-muted">{text('welcomeBody')}</p>
        </div>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-secondary-400" aria-hidden />
          <h2 className="font-semibold">Aviso de Privacidad</h2>
        </div>
        <p className="text-sm text-ink-muted">{edition?.privacy_notice_summary}</p>
        {edition?.privacy_notice_url && (
          <a
            href={edition.privacy_notice_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-secondary-300 underline underline-offset-4"
          >
            Leer el aviso completo
          </a>
        )}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-theme border border-line bg-surface-raised p-4">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-primary-500))]"
          />
          <span className="text-sm">He leído y acepto el Aviso de Privacidad para usar la experiencia digital del evento.</span>
        </label>
      </section>

      {error && <Alert tone="error">{error}</Alert>}
      <Button className="w-full" disabled={!accepted} loading={saving} onClick={onAccept}>
        Comenzar
      </Button>
    </div>
  );
}
