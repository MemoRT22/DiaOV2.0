import { useEffect, useState } from 'react';
import { fetchWinnerFolios } from '../../lib/raffleWinner';

/**
 * Folios de los resultados indicados (los mismos que ve cada persona en su Bitácora). Si no se pueden leer, el panel sigue
 * funcionando: solo muestra que el folio no está disponible, nunca bloquea confirmar. Se piden una vez por resultado.
 * `folioOf(id)`: el folio; `undefined` mientras se lee; `null` si no se pudo obtener.
 */
export function useWinnerFolios(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [folios, setFolios] = useState<Map<string, string>>(new Map());
  const [settled, setSettled] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!key) return;
    let current = true;
    const wanted = key.split(',');
    const done = () => { if (current) setSettled((previous) => new Set([...previous, ...wanted])); };
    fetchWinnerFolios(wanted).then(
      (found) => { if (current) setFolios((previous) => new Map([...previous, ...found])); done(); },
      done,
    );
    return () => { current = false; };
  }, [key]);
  const folioOf = (id?: string | null): string | null | undefined => (!id ? undefined : folios.get(id) ?? (settled.has(id) ? null : undefined));
  return { folios, folioOf };
}
