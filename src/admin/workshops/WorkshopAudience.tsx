import { useRef, useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';

type Audience = 'students' | 'educators';

export default function WorkshopAudience({ activityId }: { activityId: string }) {
  const { data, loading, error, reload } = useLoad(
    () => rpc<Audience>('activity_audience', { p_activity: activityId }), [activityId],
  );
  const [choice, setChoice] = useState<Audience | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const save = async () => {
    if (busy.current || !choice || choice === data) return;
    busy.current = true; setSaving(true); setFailure(''); setNotice('');
    try {
      await rpc('set_activity_audience', { p_activity: activityId, p_audience: choice });
      await reload(); setChoice(null); setNotice('Público del taller actualizado.');
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="card admin-detail-section space-y-4 p-5" aria-label="Público del taller">
    <h2 className="text-lg font-bold">Público del taller</h2>
    <p className="text-sm text-ink-muted">Los talleres exclusivos para personal educativo se conservan en Coordinación y no se ofrecen en el recorrido de estudiantes.</p>
    {error ? <Alert tone="error">{friendlyError(error)} <button onClick={reload} className="underline">Reintentar</button></Alert> : <>
      <label className="block text-sm">Dirigido a
        <select className="input mt-1" value={choice ?? data ?? 'students'} disabled={loading || saving}
          onChange={(event) => { setChoice(event.target.value as Audience); setNotice(''); }}>
          <option value="students">Estudiantes</option>
          <option value="educators">Exclusivo para personal educativo</option>
        </select>
      </label>
      <Button onClick={() => void save()} loading={saving} disabled={loading || saving || !choice || choice === data}>Guardar público</Button>
    </>}
    {failure && <Alert tone="error">{failure}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
  </section>;
}
