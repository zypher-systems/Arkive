import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from '../icons';

export type MenuItem =
  | {
      kind?: 'item';
      id: string;
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** Render as a link instead of a button. */
      href?: string;
      download?: boolean;
      onSelect?: () => void;
    }
  | { kind: 'separator'; id: string }
  | { kind: 'label'; id: string; label: ReactNode };

type Point = { x: number; y: number };

/**
 * The floating list itself. Keyboard: ↑/↓/Home/End move, Enter/Space
 * activate, Escape/Tab close (focus returns to the trigger), letters jump.
 */
export function MenuList({
  items,
  anchor,
  point,
  align = 'start',
  onClose,
  label,
  minWidth = 208,
  id,
}: {
  id?: string;
  items: MenuItem[];
  anchor?: HTMLElement | null;
  point?: Point;
  align?: 'start' | 'end';
  onClose: (reason?: 'select' | 'dismiss' | 'tab') => void;
  label?: string;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (point) {
      left = point.x;
      top = point.y;
    } else if (anchor) {
      const r = anchor.getBoundingClientRect();
      left = align === 'end' ? r.right - w : r.left;
      top = r.bottom + 4;
      if (top + h > vh - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    } else {
      left = vw / 2 - w / 2;
      top = vh / 2 - h / 2;
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    setPos({ left, top });
  }, [anchor, point, align]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus({ preventScroll: true });
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) {
        onClose('dismiss');
      }
    }
    function onScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose('dismiss');
    }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('touchstart', onDown as unknown as EventListener, true);
    const onResize = () => onClose('dismiss');
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('touchstart', onDown as unknown as EventListener, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusables() {
    return Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') || [],
    );
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    const list = focusables();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(idx + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose('dismiss');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose('tab');
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const start = idx + 1;
      for (let i = 0; i < list.length; i++) {
        const el = list[(start + i) % list.length];
        if ((el.textContent || '').trim().toLowerCase().startsWith(ch)) {
          el.focus();
          break;
        }
      }
    }
  }

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth }}
      className="animate-pop fixed z-[120] max-h-[70vh] origin-top overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-md outline-none"
    >
      {items.map((item) => {
        if (item.kind === 'separator') return <div key={item.id} role="separator" className="my-1 h-px bg-line" />;
        if (item.kind === 'label')
          return (
            <div key={item.id} className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-wide text-faint uppercase">
              {item.label}
            </div>
          );
        const cls = `flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-base outline-none transition-colors coarse:py-2.5 ${
          item.disabled
            ? 'cursor-not-allowed opacity-45'
            : item.danger
              ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft'
              : 'text-ink hover:bg-hover focus:bg-hover'
        }`;
        const inner = (
          <>
            {item.checked !== undefined ? (
              <span className="flex w-4 shrink-0 justify-center text-accent">
                {item.checked && <CheckIcon size={14} />}
              </span>
            ) : (
              item.icon && <span className={`shrink-0 ${item.danger ? '' : 'text-muted'}`}>{item.icon}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <kbd className="ml-4 font-sans text-xs text-faint">{item.shortcut}</kbd>}
          </>
        );
        const role = item.checked !== undefined ? 'menuitemradio' : 'menuitem';
        if (item.href && !item.disabled) {
          return (
            <a
              key={item.id}
              role={role}
              tabIndex={-1}
              href={item.href}
              download={item.download || undefined}
              className={cls}
              onClick={() => {
                item.onSelect?.();
                onClose('select');
              }}
            >
              {inner}
            </a>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role={role}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className={cls}
            onClick={() => {
              if (item.disabled) return;
              onClose('select');
              item.onSelect?.();
            }}
          >
            {inner}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Dropdown menu bound to a trigger element. The trigger receives
 * aria-haspopup/expanded/controls and toggles on click or ↓/Enter/Space.
 */
export function DropdownMenu({
  trigger,
  items,
  align = 'start',
  label,
  minWidth,
}: {
  trigger: ReactElement<Record<string, unknown>>;
  items: MenuItem[] | (() => MenuItem[]);
  align?: 'start' | 'end';
  label?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const id = useId();

  const close = useCallback((reason?: string) => {
    setOpen(false);
    if (reason !== 'select') triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const props = trigger.props as {
    onClick?: (e: unknown) => void;
    onKeyDown?: (e: ReactKeyboardEvent) => void;
  };
  const cloned = cloneElement(trigger, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: (e: unknown) => {
      props.onClick?.(e);
      setOpen((v) => !v);
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      props.onKeyDown?.(e);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
    },
  });

  return (
    <>
      {cloned}
      {open && (
        <MenuList
          items={typeof items === 'function' ? items() : items}
          anchor={triggerRef.current}
          align={align}
          onClose={close}
          label={label}
          minWidth={minWidth}
          id={id}
        />
      )}
    </>
  );
}
