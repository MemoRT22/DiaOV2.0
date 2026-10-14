import { useEffect, useRef, useState } from 'react';
import { fetchWinnerFolios } from '../../lib/raffleWinner';

/**
 * Folios de los resultados indicados (los mismos que ve cada persona en su Bitácora). Si no se pueden leer, el panel sigue
 * funcionando: solo muestra que el folio no está disponible, nunca bloquea confirmar. Cada resultado se pide una sola vez
 * (al llegar uno nuevo solo se consulta ese), y `fetchWinnerFolios` ya reparte los ids en lotes que el servidor acepta.
 * `folioOf(id)`: el folio; `undefined` mientras se lee; `null` si no se pudo obtener.
 */
export function useWinnerFolios(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [folios, setFolios] = useState<Map<string, string>>(new Map());
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const requested = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(',').filter((id) => !requested.current.has(id));
    if (wanted.length === 0) return;
    wanted.forEach((id) => requested.current.add(id));
    const done = () => setSettled((previous) => new Set([...previous, ...wanted]));
    // Sin cancelación por desmontaje: la lectura de un resultado no pierde valor, y así un cambio de lista a medias no deja ids sin responder.
    fetchWinnerFolios(wanted).then(
      (found) => { setFolios((previous) => new Map([...previous, ...found])); done(); },
      done,
    );
  }, [key]);
  const folioOf = (id?: string | null): string | null | undefined => (!id ? undefined : folios.get(id) ?? (settled.has(id) ? null : undefined));
  return { folios, folioOf };
}
