import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';

type Rule = { level: number; required_attendances: number; required_divisions: number; is_provisional: boolean };

function validate(rules: Rule[]): string | null {
  if (rules[0].required_attendances !== 0 || rules[0].required_divisions !== 0) return 'El primer rango debe empezar en 0.';
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.required_divisions > r.required_attendances) return `En el rango ${r.level}, las divisiones no pueden superar a las asistencias.`;
    if (i > 0) {
      const p = rules[i - 1];
      if (r.required_attendances < p.required_attendances || r.required_divisions < p.required_divisions)
        return `El rango ${r.level} no puede pedir menos que el anterior.`;
      if (r.required_attendances === p.required_attendances && r.required_divisions === p.required_divisions)
        return `El rango ${r.level} debe pedir más que el anterior.`;
    }
  }
  return null;
}

export default function RankRules() {
  const { edition, rankName, term } = useTheme();
  const { data, error, loading, reload } = useLoad(async () => {
    if (!edition) throw new Error('NO_ACTIVE_EDITION');
    const { data: rows, error: e } = await supabase
      .from('rank_levels')
      .select('level, required_attendances, required_divisions, is_provisional')
      .eq('edition_id', edition.id)
      .order('level');
    if (e) throw e;
    if (!rows || rows.length !== 5) throw new Error('INVALID_RULES');
    return rows as Rule[];
  }, [edition?.id]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (data) setRules(data);
  }, [data]);

  if (loading) return <Spinner />;
  if (error || !data || rules.length !== 5) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  const locked = edition?.mode === 'operacion_real';
  const problem = validate(rules);
  const provisional = data.some((r) => r.is_provisional);

  const update = (idx: number, key: 'required_attendances' | 'required_divisions', value: string) => {
    setStatus(null);
    const n = Math.max(0, Math.min(50, Number.parseInt(value, 10) || 0));
    setRules((cur) => cur.map((r, i) => (i === idx ? { ...r, [key]: n } : r)));
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const payload = rules.map(({ level, required_attendances, required_divisions }) => ({ level, required_attendances, required_divisions }));
      const { error: e } = await supabase.rpc('update_rank_rules', { p_rules: payload });
      if (e) throw e;
      setStatus({ tone: 'success', msg: 'Reglas guardadas.' });
      reload();
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const input = 'h-11 w-20 rounded-theme border border-line bg-surface px-3 text-center text-base text-ink focus:border-secondary-400 focus:outline-none disabled:opacity-60';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Reglas de {term('rank', true).toLowerCase()}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Define cuántas asistencias y cuántas divisiones distintas se necesitan para alcanzar cada nivel. Los nombres se editan en la
          temática.
        </p>
      </header>

      {provisional && <Alert tone="warning">Estas reglas son provisionales. Confírmalas o ajústalas antes del evento.</Alert>}
      {locked && <Alert>La edición está en operación real; las reglas ya no se pueden modificar.</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-muted">
              <th className="px-4 py-3 font-semibold">Nivel</th>
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Asistencias</th>
              <th className="px-4 py-3 font-semibold">Divisiones distintas</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, idx) => (
              <tr key={r.level} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Badge tone="neutral">{r.level}</Badge>
                </td>
                <td className="px-4 py-3 font-semibold">{rankName(r.level)}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    className={input}
                    value={r.required_attendances}
                    disabled={locked || idx === 0}
                    onChange={(e) => update(idx, 'required_attendances', e.target.value)}
                    aria-label={`Asistencias para nivel ${r.level}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    className={input}
                    value={r.required_divisions}
                    disabled={locked || idx === 0}
                    onChange={(e) => update(idx, 'required_divisions', e.target.value)}
                    aria-label={`Divisiones para nivel ${r.level}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {problem && !locked && <Alert tone="warning">{problem}</Alert>}
      {status && <Alert tone={status.tone}>{status.msg}</Alert>}
      {!locked && (
        <Button onClick={save} loading={busy} disabled={!!problem}>
          Guardar reglas
        </Button>
      )}
    </div>
  );
}
