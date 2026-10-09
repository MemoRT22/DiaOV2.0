import { Rocket, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useEdition } from '../edition/EditionProvider';
import { firstName } from '../lib/studentJourney';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { GuideAvatar } from './ui/Guide';
import { HowItWorks } from './ui/HowItWorks';
import { PlanetHorizon } from './ui/SpaceDecor';

/** Primer ingreso: the guide introduces itself, the day in three steps, the privacy notice in plain words, one big button. */
export default function Welcome() {
  const { text } = usePublicTheme();
  const { edition } = useEdition();
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
    <div className="animate-fade-up space-y-5">
      <section className="hero-next relative overflow-hidden rounded-theme border border-line p-5 pb-9">
        <PlanetHorizon />
        <div className="relative flex flex-col items-center text-center">
          <GuideAvatar size={112} />
          <h1 className="mt-4 text-2xl font-extrabold leading-tight">{text('welcomeTitle', { name: firstName(profile?.display_name) || profile?.display_name || '' })}</h1>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">{text('welcomeBody')}</p>
        </div>
      </section>

      <section className="space-card p-4" aria-label="Así funciona tu día">
        <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">Así funciona tu día</h2>
        <HowItWorks compact />
      </section>

      <section className="space-card p-5" aria-label="Aviso de Privacidad">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-fg-info" aria-hidden />
          <h2 className="font-extrabold">Aviso de Privacidad</h2>
        </div>
        <p className="text-sm text-ink-muted">{edition?.privacy_notice_summary}</p>
        {edition?.privacy_notice_url && (
          <a
            href={edition.privacy_notice_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-fg-info underline underline-offset-4"
          >
            Leer el aviso completo
          </a>
        )}
        <label className="mt-3 flex min-h-14 cursor-pointer items-start gap-3 rounded-theme border border-line bg-surface-raised p-4">
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
        <Rocket className="h-4 w-4" aria-hidden />
        Comenzar
      </Button>
    </div>
  );
}
