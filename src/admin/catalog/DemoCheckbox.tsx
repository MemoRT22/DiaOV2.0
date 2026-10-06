import { useEdition } from '../../edition/EditionProvider';

export function DemoCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { edition } = useEdition();
  if (edition?.mode !== 'preparacion') return null;
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary-500" />
      <span>
        Es un dato de prueba
        <span className="block text-xs text-ink-muted">Se borra al purgar los datos de prueba. No se puede cambiar después.</span>
      </span>
    </label>
  );
}
