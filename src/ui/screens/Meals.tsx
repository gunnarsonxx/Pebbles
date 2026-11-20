import { useMemo, useState } from 'react';
import { CalendarCheck, Check, ChefHat, Clock, EyeOff, ListPlus, Plus, Trash2, Users, X } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Empty, Field, NumberInput, Sheet, TextInput, useConfirm, useToast } from '../components';
import { allRecipes, BASICS_NOTE, matchRecipe, parseIngredients, prepShopping, whatCanIMake, type RecipeMatch } from '../../core/recipes';
import { addToList, addToPlan, clearCookedPlan, cooked, deleteRecipe, removeFromPlan, saveRecipe } from '../../data/pantryActions';
import { uid } from '../../core/money';
import { titleCase } from '../../core/text';
import type { Recipe } from '../../core/types';

const FILTERS = ['All', 'Quick', 'Air Fryer', 'Meal Prep', 'Breakfast', 'Freezer'] as const;
type Filter = (typeof FILTERS)[number];
const TAGS = ['quick', 'air fryer', 'meal prep', 'breakfast', 'freezer', 'no cook', 'one pan', 'one pot'];

/** Meals from what's already in your kitchen, and this week's meal prep. */
export function MealsView({ data, openPantry }: { data: AppData; openPantry: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('All');
  const [open, setOpen] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const [planning, setPlanning] = useState(false);
  const recipes = useMemo(() => allRecipes(data.customRecipes), [data.customRecipes]);
  const shown = recipes.filter((r) => filter === 'All' || r.tags.includes(filter.toLowerCase()));
  const { ready, almost } = useMemo(() => whatCanIMake(shown, data.pantry), [shown, data.pantry]);
  const plan = data.mealPlan;
  const toBuy = prepShopping(plan, recipes, data.pantry);
  const onList = new Set(data.shoplist.filter((s) => !s.done).map((s) => s.name.toLowerCase()));

  if (!data.pantry.length) {
    return (
      <div className="card">
        <Empty icon={<ChefHat className="big" />} title="What can you make tonight?">
          Add what’s in your kitchen (or pick it from a receipt) and Pebbles shows meals you can make right now, quick air fryer ideas, and easy meal prep for the week.
        </Empty>
        <div className="center">
          <button className="btn primary" onClick={openPantry}>
            <ListPlus /> Set Up Your Pantry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="eyebrow">From Your Kitchen</div>
        <div className="hero-number" style={{ fontSize: 34 }}>
          {ready.length} meal{ready.length === 1 ? '' : 's'} ready to make
        </div>
        <div className="small muted">{almost.length ? `${almost.length} more if you grab one or two things.` : 'Using what’s in your pantry now.'}</div>
        <div className="row wrap mt" style={{ gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* this week's meal prep */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">This Week’s Meal Prep</div>
            <div className="small muted">{plan.length ? 'Cook once, eat all week.' : 'Pick a few things to cook ahead, so there’s always a real meal waiting.'}</div>
          </div>
          <button className="btn small" onClick={() => setPlanning(true)}>
            <CalendarCheck /> Plan
          </button>
        </div>
        {plan.length > 0 && (
          <div className="list">
            {plan.map((e) => {
              const r = recipes.find((x) => x.id === e.id);
              if (!r) return null;
              const m = matchRecipe(r, data.pantry);
              return (
                <div key={e.id} className="list-item" style={{ opacity: e.cookedAt ? 0.6 : 1 }}>
                  <button className="grow" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={() => setOpen(r)}>
                    <div className="strong small" style={e.cookedAt ? { textDecoration: 'line-through' } : undefined}>
                      {r.name}
                      {e.batches > 1 ? ` ×${e.batches}` : ''}
                    </div>
                    <div className="tiny muted">
                      {e.cookedAt ? 'Cooked' : m.ready ? 'You have everything' : `Need: ${m.missing.map((x) => x.name).join(', ')}`} · {r.servings * e.batches} servings
                    </div>
                  </button>
                  <button className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => void removeFromPlan(e.id)}>
                    <X size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {toBuy.length > 0 && (
          <div className="mt-s">
            <div className="small strong">To buy for it</div>
            <div className="tiny muted">{toBuy.map((t) => t.name).join(' · ')}</div>
            <button
              className="btn small mt-s"
              onClick={async () => {
                const add = toBuy.filter((t) => !onList.has(t.name.toLowerCase()));
                for (const t of add) await addToList(t.name);
                toast(add.length ? `Added ${add.length} to your list` : 'Already on your list');
              }}
            >
              <ListPlus /> Add to My List
            </button>
          </div>
        )}
        {plan.some((e) => e.cookedAt) && (
          <button className="btn ghost small mt-s" onClick={() => void clearCookedPlan()}>
            Clear Cooked
          </button>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">Ready Now</div>
        {ready.length ? (
          <div className="list">
            {ready.map((m) => (
              <RecipeRow key={m.recipe.id} m={m} onOpen={() => setOpen(m.recipe)} />
            ))}
          </div>
        ) : (
          <p className="small muted">Nothing complete yet with this filter. Check “One or Two Things Away” below.</p>
        )}
      </div>

      {almost.length > 0 && (
        <div className="card">
          <div className="eyebrow">One or Two Things Away</div>
          <div className="list">
            {almost.slice(0, 12).map((m) => (
              <RecipeRow key={m.recipe.id} m={m} onOpen={() => setOpen(m.recipe)} />
            ))}
          </div>
        </div>
      )}

      <div className="row between">
        <span className="tiny muted">{BASICS_NOTE}</span>
        <button className="btn small" onClick={() => setEditing('new')}>
          <Plus /> My Own Recipe
        </button>
      </div>

      {open && <RecipeSheet data={data} recipe={open} onClose={() => setOpen(null)} onEdit={() => (setEditing(open), setOpen(null))} />}
      {editing && <RecipeEditor recipe={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {planning && <PlanSheet data={data} recipes={recipes} onClose={() => setPlanning(false)} />}
    </div>
  );
}

function RecipeRow({ m, onOpen }: { m: RecipeMatch; onOpen: () => void }) {
  return (
    <button className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={onOpen}>
      <div className="list-icon">
        <ChefHat />
      </div>
      <div className="grow">
        <div className="strong small">{m.recipe.name}</div>
        <div className="tiny muted">
          {m.recipe.minutes} min · {m.recipe.tags.slice(0, 2).map((t) => titleCase(t)).join(', ')}
          {m.ready ? ` · uses ${m.have.map((h) => h.item.name).slice(0, 3).join(', ')}` : ''}
        </div>
        {!m.ready && <div className="tiny warn">Need: {m.missing.map((x) => x.name).join(', ')}</div>}
      </div>
    </button>
  );
}

function RecipeSheet({ data, recipe, onClose, onEdit }: { data: AppData; recipe: Recipe; onClose: () => void; onEdit: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const m = matchRecipe(recipe, data.pantry);
  const planned = data.mealPlan.find((e) => e.id === recipe.id && !e.cookedAt);
  return (
    <Sheet
      title={recipe.name}
      onClose={onClose}
      footer={
        <>
          {!planned && (
            <button
              className="btn"
              onClick={async () => {
                await addToPlan(recipe.id);
                toast(`${recipe.name} is in this week’s meal prep`);
              }}
            >
              <CalendarCheck /> Meal Prep
            </button>
          )}
          <button
            className="btn primary"
            disabled={!m.have.length}
            onClick={async () => {
              const undo = await cooked(m);
              toast('Nice. Pebbles took what you used off your pantry.', { label: 'Undo', run: undo });
              onClose();
            }}
          >
            <Check /> I Made This
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <div className="row wrap small ink2" style={{ gap: 12 }}>
          <span className="row gap-s">
            <Clock size={15} /> {recipe.minutes} min
          </span>
          <span className="row gap-s">
            <Users size={15} /> {recipe.servings} serving{recipe.servings === 1 ? '' : 's'}
          </span>
          <span>{recipe.tags.map((t) => titleCase(t)).join(' · ')}</span>
        </div>
        <div>
          <div className="eyebrow">Ingredients</div>
          <div className="list">
            {recipe.ingredients.map((ing) => {
              const h = m.have.find((x) => x.ing === ing);
              return (
                <div key={ing.name} className="row between small" style={{ padding: '5px 0' }}>
                  <span className={h ? '' : ing.optional ? 'muted' : 'warn'}>
                    {h ? '✓ ' : ing.optional ? '○ ' : '✗ '}
                    {ing.qty ? `${ing.qty} ` : ''}
                    {ing.name}
                    {ing.optional ? ' (optional)' : ''}
                  </span>
                  <span className="tiny muted">{h ? h.item.name : ''}</span>
                </div>
              );
            })}
          </div>
          {m.missing.length > 0 && (
            <button
              className="btn small mt-s"
              onClick={async () => {
                for (const x of m.missing) await addToList(x.name);
                toast(`Added ${m.missing.length} to your list`);
              }}
            >
              <ListPlus /> Add What’s Missing to My List
            </button>
          )}
        </div>
        <div>
          <div className="eyebrow">Steps</div>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
            {recipe.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="row gap-s">
          {recipe.custom ? (
            <>
              <button className="btn ghost small" onClick={onEdit}>
                Edit
              </button>
              <button
                className="btn ghost small danger"
                onClick={async () => {
                  if (await ask({ title: `Delete ${recipe.name}?`, confirm: 'Delete', danger: true })) {
                    await deleteRecipe(recipe.id);
                    onClose();
                  }
                }}
              >
                <Trash2 /> Delete
              </button>
            </>
          ) : (
            <button
              className="btn ghost small"
              onClick={async () => {
                await saveRecipe({ ...recipe, hidden: true });
                toast(`${recipe.name} hidden`);
                onClose();
              }}
            >
              <EyeOff /> Not for Me
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function PlanSheet({ data, recipes, onClose }: { data: AppData; recipes: Recipe[]; onClose: () => void }) {
  const toast = useToast();
  const options = recipes
    .filter((r) => r.tags.includes('meal prep') || r.tags.includes('freezer'))
    .map((r) => matchRecipe(r, data.pantry))
    .sort((a, b) => b.score - a.score);
  const [picked, setPicked] = useState<Set<string>>(new Set(data.mealPlan.filter((e) => !e.cookedAt).map((e) => e.id)));
  const servings = options.filter((o) => picked.has(o.recipe.id)).reduce((s, o) => s + o.recipe.servings, 0);
  return (
    <Sheet
      title="Plan This Week’s Meal Prep"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={async () => {
            const current = new Set(data.mealPlan.filter((e) => !e.cookedAt).map((e) => e.id));
            for (const id of picked) if (!current.has(id)) await addToPlan(id);
            for (const id of current) if (!picked.has(id)) await removeFromPlan(id);
            toast(picked.size ? `${picked.size} meal${picked.size === 1 ? '' : 's'} planned · about ${servings} servings` : 'Plan cleared');
            onClose();
          }}
        >
          Save Plan
        </button>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          Two or three of these covers most of a week. The ones at the top use the most of what you already have. {servings ? `Picked: about ${servings} servings.` : ''}
        </p>
        <div className="list">
          {options.map((m) => {
            const on = picked.has(m.recipe.id);
            return (
              <button
                key={m.recipe.id}
                className="list-item"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => {
                  const n = new Set(picked);
                  if (on) n.delete(m.recipe.id);
                  else n.add(m.recipe.id);
                  setPicked(n);
                }}
              >
                <span className={`check-btn${on ? ' on' : ''}`} aria-hidden>
                  {on && <Check size={16} />}
                </span>
                <div className="grow">
                  <div className="strong small">{m.recipe.name}</div>
                  <div className="tiny muted">
                    {m.recipe.servings} servings · {m.recipe.minutes} min · {m.ready ? 'you have everything' : `need ${m.missing.map((x) => x.name).join(', ')}`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function RecipeEditor({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(recipe?.name ?? '');
  const [minutes, setMinutes] = useState<number | null>(recipe?.minutes ?? 20);
  const [servings, setServings] = useState<number | null>(recipe?.servings ?? 2);
  const [tags, setTags] = useState<string[]>(recipe?.tags ?? []);
  const [ings, setIngs] = useState((recipe?.ingredients ?? []).map((i) => `${i.name}${i.optional ? ' (optional)' : ''}`).join('\n'));
  const [steps, setSteps] = useState((recipe?.steps ?? []).join('\n'));
  const parsed = parseIngredients(ings);
  return (
    <Sheet
      title={recipe ? 'Edit Recipe' : 'Your Own Recipe'}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!name.trim() || !parsed.length}
          onClick={async () => {
            await saveRecipe({
              id: recipe?.id ?? uid('rcp_'),
              name: name.trim(),
              minutes: minutes ?? 20,
              servings: servings ?? 2,
              tags,
              ingredients: parsed,
              steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
              custom: true,
            });
            toast('Recipe saved');
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <div className="col gap-l">
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="Grandma’s Chicken Casserole" />
        </Field>
        <div className="form-grid two">
          <Field label="Minutes">
            <NumberInput value={minutes} onChange={setMinutes} />
          </Field>
          <Field label="Servings">
            <NumberInput value={servings} onChange={setServings} />
          </Field>
        </div>
        <Field label="Kind">
          <div className="row wrap" style={{ gap: 6 }}>
            {TAGS.map((t) => (
              <button key={t} className={`chip${tags.includes(t) ? ' on' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
                {titleCase(t)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Ingredients" hint="One per line. Add “optional” to ones you can skip.">
          <textarea className="input" rows={6} value={ings} onChange={(e) => setIngs(e.target.value)} placeholder={'Chicken breast\nRice\nCream of chicken soup\nCheese (optional)'} style={{ minHeight: 120, padding: 10 }} />
        </Field>
        <Field label="Steps" hint="One per line">
          <textarea className="input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} style={{ minHeight: 120, padding: 10 }} />
        </Field>
      </div>
    </Sheet>
  );
}
