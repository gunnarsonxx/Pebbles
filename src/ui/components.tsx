import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Baby,
  Banknote,
  Bike,
  Briefcase,
  Car,
  CircleDashed,
  Coffee,
  CreditCard,
  Fuel,
  Gift,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  PlusCircle,
  Repeat,
  RotateCcw,
  Send,
  Shield,
  ShoppingBag,
  ShoppingBasket,
  SprayCan,
  Ticket,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { categoryOf } from '../core/categories';
import { GEM_BY_ID } from '../core/categories';
import type { GemName } from '../core/types';

// ---------------- category icons ----------------

const ICONS: Record<string, typeof House> = {
  briefcase: Briefcase,
  'plus-circle': PlusCircle,
  'rotate-ccw': RotateCcw,
  home: House,
  zap: Zap,
  wifi: Wifi,
  shield: Shield,
  landmark: Landmark,
  repeat: Repeat,
  baby: Baby,
  'shopping-basket': ShoppingBasket,
  fuel: Fuel,
  car: Car,
  'heart-pulse': HeartPulse,
  'spray-can': SprayCan,
  'paw-print': PawPrint,
  coffee: Coffee,
  bike: Bike,
  'shopping-bag': ShoppingBag,
  ticket: Ticket,
  plane: Plane,
  gift: Gift,
  send: Send,
  banknote: Banknote,
  'alert-triangle': AlertTriangle,
  'circle-dashed': CircleDashed,
  'piggy-bank': PiggyBank,
  'arrow-left-right': ArrowLeftRight,
  'credit-card': CreditCard,
};

export const GROUP_COLOR: Record<string, string> = {
  bills: 'var(--sapphire)',
  essentials: 'var(--citrine)',
  personal: 'var(--amethyst)',
  savings: 'var(--jade)',
  income: 'var(--good)',
  transfer: 'var(--ink-3)',
};

export function CategoryIcon({ id, size = 38 }: { id: string; size?: number }) {
  const c = categoryOf(id);
  const Icon = ICONS[c.icon] ?? CircleDashed;
  const color = GROUP_COLOR[c.group];
  return (
    <div className="list-icon" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 14%, var(--card))`, color }}>
      <Icon />
    </div>
  );
}

// ---------------- gem ----------------

export function GemIcon({ gem, size = 18, title }: { gem: GemName; size?: number; title?: string }) {
  const g = GEM_BY_ID[gem] ?? GEM_BY_ID.quartz;
  const c = g.color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={title ?? g.name} role="img">
      <title>{title ?? g.name}</title>
      <polygon points="12,2 21,8.5 17.5,21 6.5,21 3,8.5" fill={c} />
      <polygon points="12,2 21,8.5 12,10" fill="#fff" opacity="0.28" />
      <polygon points="12,2 3,8.5 12,10" fill="#fff" opacity="0.12" />
      <polygon points="3,8.5 12,10 6.5,21" fill="#000" opacity="0.08" />
      <polygon points="21,8.5 12,10 17.5,21" fill="#000" opacity="0.18" />
      <polygon points="12,10 6.5,21 17.5,21" fill="#000" opacity="0.04" />
    </svg>
  );
}

export function PebbleLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M6,46 C5,38 17,33 32,33 C47,33 59,37 58,45 C57,53 46,56 32,56 C18,56 7,53 6,46 Z" fill="#7E776C" />
      <path d="M14,31 C13,24 22,20 32,20 C43,20 51,23 50,30 C50,36 42,39 32,39 C22,39 15,37 14,31 Z" fill="#B6A587" />
      <path d="M20,14 C20,8 26,5 33,5 C40,5 45,8 45,14 C44,20 39,22 32,22 C25,22 20,20 20,14 Z" fill="var(--moss)" />
      <ellipse cx="28" cy="10" rx="5" ry="1.6" fill="#fff" opacity="0.35" />
      <ellipse cx="25" cy="26" rx="6" ry="1.8" fill="#fff" opacity="0.3" />
    </svg>
  );
}

// ---------------- sheet ----------------

export function Sheet({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children}
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- form controls ----------------

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  step = 'any',
  min,
  placeholder,
  allowEmpty,
  autoFocus,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  min?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? '' : String(value));
    }
  }, [value]);
  return (
    <div className="input-wrap">
      {prefix && <span className="prefix">{prefix}</span>}
      <input
        className={`input num${prefix ? ' has-prefix' : ''}${suffix ? ' has-suffix' : ''}`}
        inputMode="decimal"
        type="text"
        value={text}
        step={step}
        min={min}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.\-]/g, '');
          setText(t);
          if (t === '' || t === '-' || t === '.') {
            if (allowEmpty) {
              last.current = null;
              onChange(null);
            }
            return;
          }
          const v = parseFloat(t);
          if (!isNaN(v)) {
            last.current = v;
            onChange(v);
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; ariaLabel?: string; type?: string }) {
  return (
    <input
      className="input"
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function ToggleRow({ title, hint, on, onChange }: { title: ReactNode; hint?: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ padding: '6px 0' }}>
      <div className="grow">
        <div className="strong">{title}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <Toggle on={on} onChange={onChange} label={typeof title === 'string' ? title : 'toggle'} />
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      <div className="small muted">{children}</div>
    </div>
  );
}

// ---------------- toast ----------------

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------- images ----------------

/** Shrink a picked photo so it syncs quickly (max 900px, JPEG). */
export async function compressImage(file: File, max = 900, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
