import { useMemo, useState } from 'react';
import { CalendarCheck, Check, ChefHat, Clock, EyeOff, ListPlus, Minus, Plus, Sparkles, Trash2, Users, X } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Empty, Field, NumberInput, Sheet, TextInput, useConfirm, useToast, ShowMore } from '../components';
import { allRecipes, BASICS_NOTE, matchRecipe, parseIngredients, prepShopping, usedUp, whatCanIMake, type RecipeMatch } from '../../core/recipes';
import { addToList, addToPlan, clearCookedPlan, cooked, deleteRecipe, removeFromPlan, saveRecipe } from '../../data/pantryActions';
import { uid } from '../../core/money';
import { titleCase } from '../../core/text';
import type { PantryItem, Recipe } from '../../core/types';
import { type MealDetail } from '../../core/mealdb';
import { findRecipes, loadRecipe, SOURCE_NAME, type RecipeHit, type RecipeKeys, type RecipeSource } from '../../core/recipeSearch';
import { stockOf } from '../../core/pantry';
import { http } from '../../platform';

const FILTERS = ['All', 'Quick', 'Air Fryer', 'Breakfast', 'Lunch', 'Dinner', 'Meal Prep', 'Slow Cooker', 'Soup', 'Pasta', 'Freezer', 'Takes a While'] as const;
type Filter = (typeof FILTERS)[number];
const TAGS = ['quick', 'air fryer', 'breakfast', 'lunch', 'dinner', 'snack', 'meal prep', 'slow cooker', 'soup', 'pasta', 'baking', 'freezer', 'no cook', 'one pan', 'one pot'];

/** Quick = 20 minutes or less; Takes a While = an hour or more (mostly hands-off); the rest by tag. */
const fits = (r: Recipe, f: Filter) => (f === 'All' ? true : f === 'Quick' ? r.minutes <= 20 || r.tags.includes('quick') : f === 'Takes a While' ? r.minutes >= 60 : r.tags.includes(f.toLowerCase()));

/** "15 min", "1 hr 15 min", "8 hr". */
export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`);

/** Meals from what's already in your kitchen, and this week's meal prep. */
export function MealsView({ data, openPantry }: { data: AppData; openPantry: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('All');
  const [open, setOpen] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const [planning, setPlanning] = useState(false);
  const [browse, setBrowse] = useState(false);
  const recipes = useMemo(() => allRecipes(data.customRecipes), [data.customRecipes]);
  const shown = recipes.filter((r) => fits(r, filter));
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
            <ShowMore items={ready} first={3} render={(m) => <RecipeRow key={m.recipe.id} m={m} onOpen={() => setOpen(m.recipe)} />} more="more you can make" />
          </div>
        ) : (
          <p className="small muted">Nothing complete yet with this filter. Check “One or Two Things Away” below.</p>
        )}
      </div>

      {almost.length > 0 && (
        <div className="card">
          <div className="eyebrow">One or Two Things Away</div>
          <div className="list">
            <ShowMore items={almost.slice(0, 12)} first={3} render={(m) => <RecipeRow key={m.recipe.id} m={m} onOpen={() => setOpen(m.recipe)} />} more="more" />
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <div className="eyebrow">All Recipes{filter !== 'All' ? ` · ${filter}` : ''}</div>
          <button className="btn small" onClick={() => setBrowse(!browse)}>
            {browse ? 'Hide' : `Browse ${shown.length}`}
          </button>
        </div>
        {browse && (
          <div className="list mt-s">
            {[...shown]
              .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name))
              .map((r) => (
                <RecipeRow key={r.id} m={matchRecipe(r, data.pantry)} onOpen={() => setOpen(r)} />
              ))}
          </div>
        )}
      </div>

      <OnlineRecipes data={data} />

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
          {fmtMinutes(m.recipe.minutes)} ·{' '}
          {m.recipe.tags
            .slice(0, 2)
            .map((t) => titleCase(t))
            .join(', ')}
          {m.ready
            ? ` · uses ${m.have
                .map((h) => h.item.name)
                .slice(0, 3)
                .join(', ')}`
            : ''}
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
  const [cooking, setCooking] = useState(false);
  if (cooking) return <CookedSheet m={m} batches={planned?.batches ?? 1} onClose={onClose} onBack={() => setCooking(false)} toast={toast} />;
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
          <button className="btn primary" disabled={!m.have.length} onClick={() => setCooking(true)}>
            <Check /> I Made This
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <div className="row wrap small ink2" style={{ gap: 12 }}>
          <span className="row gap-s">
            <Clock size={15} /> {fmtMinutes(recipe.minutes)}
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
                    {m.recipe.servings} servings · {fmtMinutes(m.recipe.minutes)} · {m.ready ? 'you have everything' : `need ${m.missing.map((x) => x.name).join(', ')}`}
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
              steps: steps
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
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
          <textarea
            className="input"
            rows={6}
            value={ings}
            onChange={(e) => setIngs(e.target.value)}
            placeholder={'Chicken breast\nRice\nCream of chicken soup\nCheese (optional)'}
            style={{ minHeight: 120, padding: 10 }}
          />
        </Field>
        <Field label="Steps" hint="One per line">
          <textarea className="input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} style={{ minHeight: 120, padding: 10 }} />
        </Field>
      </div>
    </Sheet>
  );
}

const LEVELS: PantryItem['level'][] = ['full', 'half', 'low', 'out'];
const LEVEL_LABEL: Record<PantryItem['level'], string> = { full: 'Full', half: 'Half', low: 'Low', out: 'Out' };

/** "I Made This": what it used, as a suggestion you can change, before anything comes off your pantry. */
function CookedSheet({ m, batches, onClose, onBack, toast }: { m: RecipeMatch; batches: number; onClose: () => void; onBack: () => void; toast: ReturnType<typeof useToast> }) {
  const [after, setAfter] = useState<PantryItem[]>(() => usedUp(m, batches));
  const before = new Map(m.have.map((h) => [h.item.id, h.item]));
  const set = (id: string, patch: Partial<PantryItem>) => setAfter(after.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <Sheet
      title={`You Made ${m.recipe.name}`}
      onClose={onBack}
      footer={
        <>
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const undo = await cooked(m, after);
              toast('Saved what’s left in your pantry.', { label: 'Undo', run: undo });
              onClose();
            }}
          >
            <Check /> Save What’s Left
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          Here’s what’s left after cooking it{batches > 1 ? ` (${batches} batches)` : ''}. Counted things go down by what the recipe uses; the rest go down a step. Change anything that isn’t right.
        </p>
        <div className="list">
          {after.map((p) => {
            const was = before.get(p.id)!;
            return (
              <div key={p.id} className="list-item" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <div className="grow" style={{ minWidth: 140 }}>
                  <div className="strong small">{p.name}</div>
                  <div className="tiny muted">
                    Had {was.mode === 'level' ? LEVEL_LABEL[was.level] : `${was.qty} ${was.unit}`}
                    {p.desc ? ` · ${p.desc}` : ''}
                  </div>
                </div>
                {p.mode === 'level' ? (
                  <div className="level-pills" role="group" aria-label={`${p.name} left`}>
                    {LEVELS.map((l) => (
                      <button key={l} className={`level-pill ${l}${p.level === l ? ' on' : ''}`} aria-pressed={p.level === l} onClick={() => set(p.id, { level: l })}>
                        {LEVEL_LABEL[l]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="stepper" style={{ border: '1px solid var(--line)', borderRadius: 999 }}>
                    <button
                      className="icon-btn"
                      aria-label={`Less ${p.name}`}
                      onClick={() => set(p.id, { qty: Math.max(0, Math.round((p.qty - (p.mode === 'count' ? 1 : p.perBuy * 0.25)) * 100) / 100) })}
                    >
                      <Minus size={15} />
                    </button>
                    <span className="num strong small">
                      {p.qty} {p.unit}
                    </span>
                    <button className="icon-btn" aria-label={`More ${p.name}`} onClick={() => set(p.id, { qty: Math.round((p.qty + (p.mode === 'count' ? 1 : p.perBuy * 0.25)) * 100) / 100 })}>
                      <Plus size={15} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * More recipes from the web: TheMealDB always, plus Spoonacular with your own free key. "Use What I Have"
 * searches with everything in your pantry at once, best matches first.
 */
function OnlineRecipes({ data }: { data: AppData }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<RecipeHit[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<MealDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [srcs, setSrcs] = useState<RecipeSource[]>([]);
  const keys: RecipeKeys = data.settings.integrations;
  // everything food in your kitchen, most interesting first (staples like salt and oil don't help a search)
  const pantry = [
    ...new Set(
      data.pantry
        .filter((p) => !p.archived && stockOf(p) !== 'out' && ['meat', 'pantry', 'produce', 'dairy', 'frozen', 'bakery'].includes(p.dept))
        .map((p) => p.name)
        .filter((n) => !/^(salt|pepper|water|oil|olive oil|vegetable oil|sugar|flour)$/i.test(n)),
    ),
  ];
  const run = async (query: string | null) => {
    setBusy(true);
    setErr('');
    const r = await findRecipes(http, keys, pantry, query);
    setHits(r.hits);
    setSrcs(r.sources);
    setErr([...r.errors, ...(r.hits.length ? [] : [query ? `Nothing found for “${query}”.` : 'Nothing found for what’s in your kitchen yet.'])].join(' '));
    setBusy(false);
  };
  const more = !keys.spoonacularKey;
  return (
    <div className="card">
      <div className="eyebrow">Find More Recipes Online</div>
      <div className="small muted">
        {more ? 'From TheMealDB. Add a free Spoonacular key (Settings → Connections → Recipes) to search 365,000+ more.' : 'From TheMealDB and Spoonacular. Save any you like to your recipes.'}
      </div>
      <button className="btn primary mt-s" style={{ width: '100%' }} disabled={busy || !pantry.length} onClick={() => void run(null)}>
        <Sparkles /> {busy ? 'Searching…' : `Use What I Have (${pantry.length} thing${pantry.length === 1 ? '' : 's'})`}
      </button>
      <div className="row mt-s" style={{ gap: 8 }}>
        <div className="grow">
          <TextInput value={q} onChange={setQ} placeholder="Or search: curry, gochujang, tacos…" onEnter={() => q.trim() && void run(q.trim())} ariaLabel="Search recipes" />
        </div>
        <button className="btn" disabled={!q.trim() || busy} onClick={() => void run(q.trim())}>
          Search
        </button>
      </div>
      {err && <p className="small warn mt-s">{err}</p>}
      {hits && hits.length > 0 && (
        <>
          <div className="tiny muted mt-s">
            {hits.length} recipe{hits.length === 1 ? '' : 's'} from {srcs.map((x) => SOURCE_NAME[x]).join(', ')}, the ones that use the most of yours first.
          </div>
          <div className="list mt-s">
            <ShowMore
              items={hits.slice(0, 60)}
              first={10}
              more="more recipes"
              render={(h) => (
                <button
                  key={h.id}
                  className="list-item"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={async () => {
                    setLoadingId(h.id);
                    const d = await loadRecipe(http, keys, h);
                    setLoadingId(null);
                    if (d) setOpen(d);
                    else setErr('Couldn’t open that recipe. Try again.');
                  }}
                >
                  {h.thumb ? (
                    <img src={h.source === 'mealdb' ? `${h.thumb}/preview` : h.thumb} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} loading="lazy" />
                  ) : (
                    <ChefHat />
                  )}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong small">{h.name}</div>
                    <div className="tiny muted ellipsis">
                      {h.have.length ? `Uses your ${h.have.slice(0, 4).join(', ')}${h.have.length > 4 ? ` +${h.have.length - 4}` : ''}` : 'Matches your search'}
                      {h.missing != null ? ` · ${h.missing} to get` : ''} · {SOURCE_NAME[h.source]}
                    </div>
                  </div>
                  <span className="tiny muted">{loadingId === h.id ? 'Opening…' : '›'}</span>
                </button>
              )}
            />
          </div>
        </>
      )}
      {open && <OnlineRecipeSheet data={data} meal={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OnlineRecipeSheet({ data, meal, onClose }: { data: AppData; meal: MealDetail; onClose: () => void }) {
  const toast = useToast();
  const m = matchRecipe(meal.recipe, data.pantry);
  const saved = data.customRecipes.some((r) => r.id === meal.recipe.id);
  return (
    <Sheet
      title={meal.name}
      onClose={onClose}
      footer={
        <>
          {m.missing.length > 0 && (
            <button
              className="btn"
              onClick={async () => {
                for (const x of m.missing) await addToList(x.name);
                toast(`Added ${m.missing.length} to your list`);
              }}
            >
              <ListPlus /> Missing to List
            </button>
          )}
          <button
            className="btn primary"
            disabled={saved}
            onClick={async () => {
              await saveRecipe(meal.recipe);
              toast(`${meal.name} is in your recipes`);
              onClose();
            }}
          >
            {saved ? 'Saved' : 'Save to My Recipes'}
          </button>
        </>
      }
    >
      <div className="col gap-l">
        {meal.thumb && <img src={meal.thumb} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />}
        <div className="small ink2">
          {[meal.category, meal.area].filter(Boolean).join(' · ')} · about {fmtMinutes(meal.recipe.minutes)} (the site doesn’t list a time; this is a guess)
        </div>
        <div>
          <div className="eyebrow">Ingredients</div>
          <div className="list">
            {meal.recipe.ingredients.map((ing) => {
              const h = m.have.find((x) => x.ing === ing);
              return (
                <div key={ing.name} className="row between small" style={{ padding: '5px 0' }}>
                  <span className={h ? '' : 'warn'}>
                    {h ? '✓ ' : '✗ '}
                    {ing.qty ? `${ing.qty} ` : ''}
                    {ing.name}
                  </span>
                  <span className="tiny muted">{h ? h.item.name : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="eyebrow">Steps</div>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
            {meal.recipe.steps.map((st, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {st}
              </li>
            ))}
          </ol>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          From TheMealDB{meal.source ? ' · original recipe linked there' : ''}. {BASICS_NOTE}
        </p>
      </div>
    </Sheet>
  );
}
