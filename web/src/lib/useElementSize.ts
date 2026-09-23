import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Content-box width of an element, updated via ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Long-press detector for touch selection. Returns pointer handlers and a
 * ref telling click handlers to ignore the click that ends a long press.
 */
export function useLongPress(onLongPress: (id: string) => void, delay = 450) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const lastPointer = useRef<'mouse' | 'touch' | 'pen'>('mouse');

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  const bind = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      lastPointer.current = e.pointerType as 'mouse' | 'touch' | 'pen';
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (navigator.vibrate) navigator.vibrate(10);
        onLongPress(id);
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // Mobile browsers fire contextmenu on long press; we handle it ourselves.
      if (lastPointer.current !== 'mouse') e.preventDefault();
    },
  });

  return { bind, fired, lastPointer };
}
