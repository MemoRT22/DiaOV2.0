import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { categoryRules, type RaffleCategory, type RafflePrize } from '../../lib/raffleApi';
import { describeRule, describeRules, hasRequirement, nextTierHint } from '../../lib/raffleRules';
import { isDrawable, unitsLeft } from '../../lib/raffleShow';
import { DataPanel, EmptyState, RowAction, SectionHeading } from '../design/Primitives';
import { CategoryModal, PrizeModal } from './RaffleModals';
import type { RaffleContext } from './types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function RafflePreparation({ ctx }: { ctx: RaffleContext }) {
  const { categories, prizes, scope, prizesLoading } = ctx;
  const [editingCategory, setEditingCategory] = useState<Partial<RaffleCategory> | null>(null);
  const [editingPrize, setEditingPrize] = useState<Partial<RafflePrize> | null>(null);
  const [notice, setNotice] = useState('');

  const active = categories.filter((category) => category.is_active);
  const eligible = active.reduce((sum, category) => sum + (category.pool_count ?? 0), 0);
  const units = active.reduce((sum, category) => sum + unitsLeft(prizes[category.id] ?? []), 0);
  const withoutPrizes = active.filter((category) => (prizes[category.id] ?? []).length === 0).length;
  const newCategory = () => setEditingCategory({ is_demo: scope === 'demo', is_active: true, sort_order: 0, rules: [{ academic: 1, university_life: 1 }] });

  return (
    <div className="ad-page">
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="rf-stats" aria-label="Resumen de la preparación">
        <div><strong>{active.length}</strong><span>{active.length === 1 ? 'categoría activa' : 'categorías activas'}</span></div>
        <div><strong>{eligible}</strong><span>{eligible === 1 ? 'participante elegible' : 'participantes elegibles'}</span></div>
        <div><strong>{units}</strong><span>{units === 1 ? 'premio por entregar' : 'premios por entregar'}</span></div>
      </div>

      <section className="ad-page">
        <SectionHeading title="Categorías y premios"
          detail="Cada participante compite en la categoría más alta cuyos requisitos de sellos cumple. Los premios se sortean dentro de su categoría."
          action={<Button onClick={newCategory}>Nueva categoría</Button>} />
        {withoutPrizes > 0 && (
          <Alert tone="warning">{withoutPrizes === 1 ? 'Una categoría activa no tiene premios' : `${withoutPrizes} categorías activas no tienen premios`}: no podrán sortearse hasta que agregues uno.</Alert>
        )}
        {categories.length === 0 ? (
          <DataPanel><EmptyState title={`Sin categorías ${scope === 'demo' ? 'de prueba' : 'reales'}.`}
            description="Crea una categoría para definir los sellos necesarios; después agrégale sus premios."
            action={<Button className="mt-4" onClick={newCategory}>Nueva categoría</Button>} /></DataPanel>
        ) : categories.map((category) => (
          <CategoryCard key={category.id} category={category} prizes={prizes[category.id] ?? []} loading={prizesLoading && !prizes[category.id]}
            onEdit={() => setEditingCategory(category)}
            onAddPrize={() => setEditingPrize({ category_id: category.id, quantity: 1, is_active: true, sort_order: 0 })}
            onEditPrize={setEditingPrize} />
        ))}
      </section>

      <Eligibility ctx={ctx} />

      {editingCategory && <CategoryModal initial={editingCategory} onClose={() => setEditingCategory(null)}
        onSaved={() => { setEditingCategory(null); void ctx.refresh(); setNotice('Categoría guardada.'); }} />}
      {editingPrize && <PrizeModal initial={editingPrize} categories={categories} onClose={() => setEditingPrize(null)}
        onSaved={() => { setEditingPrize(null); void ctx.refresh(); setNotice('Premio guardado.'); }} />}
    </div>
  );
}

function CategoryCard({ category, prizes, loading, onEdit, onAddPrize, onEditPrize }: {
  category: RaffleCategory; prizes: RafflePrize[]; loading: boolean;
  onEdit: () => void; onAddPrize: () => void; onEditPrize: (prize: RafflePrize) => void;
}) {
  const pool = category.pool_count ?? 0;
  return (
    <article className="rf-cat" data-inactive={!category.is_active || undefined} aria-label={`Categoría ${category.name}`}>
      <header className="rf-cat-head">
        <div className="rf-cat-title">
          <h3>{category.name}</h3>
          {!category.is_active && <Badge tone="neutral">Inactiva</Badge>}
          <p>{describeRules(categoryRules(category))}</p>
        </div>
        <div className="ad-metric"><strong>{pool}</strong><span>{pool === 1 ? 'elegible' : 'elegibles'}</span></div>
        <RowAction onClick={onEdit} label={`Editar categoría ${category.name}`}>Editar</RowAction>
      </header>
      <div className="rf-cat-prizes">
        {loading ? <div className="rf-cat-empty"><Spinner label="Cargando premios" /></div> : prizes.length === 0 ? (
          <div className="rf-cat-empty">
            <p><strong>Sin premios.</strong> {category.is_active ? 'No se puede sortear esta categoría hasta que tenga al menos uno.' : 'Está inactiva y tampoco tiene premios.'}</p>
          </div>
        ) : prizes.map((prize) => {
          const exhausted = prize.is_active && !isDrawable(prize);
          return (
            <div key={prize.id} className="rf-prize-row" data-state={exhausted ? 'exhausted' : !prize.is_active ? 'inactive' : undefined}>
              <div className="ad-row-main">
                <p className="ad-row-title">{prize.name}{' '}
                  {!prize.is_active && <Badge tone="neutral">Inactivo</Badge>}
                  {exhausted && <Badge tone="warning">Agotado</Badge>}</p>
                <p className="ad-row-meta">{prize.description || `${prize.delivered} de ${prize.quantity} comprometidos`}</p>
              </div>
              <div className="rf-prize-stock" role="img" aria-label={`${prize.available} de ${prize.quantity} disponibles`}>
                <strong>{prize.available}<small> / {prize.quantity}</small></strong>
                <span>disponibles</span>
                <i style={{ ['--fill' as string]: `${prize.quantity > 0 ? Math.max(0, Math.min(100, (prize.available / prize.quantity) * 100)) : 0}%` }} />
              </div>
              <RowAction onClick={() => onEditPrize(prize)} label={`Editar premio ${prize.name}`}>Editar</RowAction>
            </div>
          );
        })}
        <div className="rf-cat-foot"><Button variant="ghost" onClick={onAddPrize}>+ Agregar premio a {category.name}</Button></div>
      </div>
    </article>
  );
}

/**
 * Who is in each pool, as far as the server tells us: how many, what each category asks for and the stamp
 * combinations that reach none. The names and the stamps of each eligible participant are not exposed yet.
 */
function Eligibility({ ctx }: { ctx: RaffleContext }) {
  const active = ctx.categories.filter((category) => category.is_active);
  const total = active.reduce((sum, category) => sum + (category.pool_count ?? 0), 0);
  const biggest = Math.max(1, ...active.map((category) => category.pool_count ?? 0));
  const tiers = active.map((category) => ({ id: category.id, name: category.name, sort_order: category.sort_order, rules: categoryRules(category).filter(hasRequirement) }));
  const unassignedTotal = ctx.unassigned.reduce((sum, combo) => sum + combo.count, 0);

  return (
    <section className="ad-page">
      <SectionHeading title="Participantes elegibles"
        detail={`${plural(total, 'participante compite', 'participantes compiten')} ahora en ${plural(active.length, 'categoría activa', 'categorías activas')}. Quien ya tiene un premio confirmado no vuelve a competir.`} />
      <DataPanel>
        {active.length === 0 && <EmptyState title="Aún no hay categorías activas." description="Cuando haya una, aquí verás cuántos participantes califican y qué sellos necesitan." />}
        {active.map((category) => {
          const pool = category.pool_count ?? 0;
          return (
            <div key={category.id} className="rf-elig-row">
              <div className="ad-row-main">
                <p className="ad-row-title">{category.name}</p>
                <ul className="rf-rule-list">{categoryRules(category).map((rule, index) => <li key={index}>{index > 0 && <em>o </em>}{describeRule(rule)}</li>)}</ul>
              </div>
              <div className="rf-elig-bar" aria-hidden><i style={{ width: `${(pool / biggest) * 100}%` }} /></div>
              <div className="ad-metric"><strong>{pool}</strong><span>{pool === 1 ? 'elegible' : 'elegibles'}</span></div>
            </div>
          );
        })}
      </DataPanel>

      {ctx.unassignedVisible && (
        <details className="ad-inline-note rf-unassigned">
          <summary>Con sellos, pero sin categoría todavía · {plural(unassignedTotal, 'participante', 'participantes')}</summary>
          <p>Ya acreditaron sellos, pero no cumplen los requisitos de ninguna categoría activa. Esto es lo que les falta para la más cercana:</p>
          <ul>
            {ctx.unassigned.map((combo, index) => {
              const hint = nextTierHint({ academic_stamps: combo.academic, university_life_stamps: combo.university_life, categories: tiers });
              return (
                <li key={index}><strong>{combo.academic} {combo.academic === 1 ? 'académico' : 'académicos'} + {combo.university_life} de Vida Universitaria</strong>
                  {' · '}{plural(combo.count, 'participante', 'participantes')}{hint ? ` · ${hint.text}` : ''}</li>
              );
            })}
          </ul>
        </details>
      )}

      <p className="rf-limit">
        <strong>Detalle por persona.</strong> El servidor todavía no entrega la lista de elegibles con su desglose de sellos y asistencias, así que aquí solo se muestran totales por categoría.
        Para revisar a una persona concreta abre su expediente en <Link to="/coordinacion/participantes">Participantes</Link>.
      </p>
    </section>
  );
}
