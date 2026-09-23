import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UploadIcon, LockIcon } from '../icons';
import { collectDrop, dragHasFiles } from '../../lib/dropFiles';
import { useUploadEngine, type UploadTarget } from '../../lib/uploads';
import { useI18n } from '../../i18n';

/**
 * Full-window drop zone for OS files/folders. It is purely visual
 * (pointer-events: none) so folder rows underneath still receive drags and
 * can accept a drop into themselves; anything dropped elsewhere lands in
 * the folder currently shown (or My files).
 */
export function DropOverlay({ fallbackTarget }: { fallbackTarget: UploadTarget | null }) {
  const { t } = useI18n();
  const { engine, activeFolder } = useUploadEngine();
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const readOnly = !!activeFolder?.readOnly;
  const target = readOnly ? null : activeFolder?.target || fallbackTarget;
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    function onEnter(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current += 1;
      setActive(true);
    }
    function onOver(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = targetRef.current ? 'copy' : 'none';
    }
    function onLeave(e: DragEvent) {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    }
    function reset() {
      depth.current = 0;
      setActive(false);
    }
    function onDrop(e: DragEvent) {
      reset();
      if (!e.dataTransfer || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const dest = targetRef.current;
      if (!dest) return;
      void collectDrop(e.dataTransfer).then((files) => {
        if (files.length) engine.enqueue(files, dest);
      });
    }
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    // Rows that consume a drop stop propagation; this resets the overlay anyway.
    window.addEventListener('drop', reset, true);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset, true);
    };
  }, [engine]);

  if (!active) return null;
  return createPortal(
    <div aria-hidden className="animate-fade-in pointer-events-none fixed inset-0 z-[150]">
      <div
        className={`absolute inset-2 rounded-2xl border-2 border-dashed sm:inset-3 ${
          target ? 'border-accent bg-accent-soft/60' : 'border-strong bg-overlay/10'
        }`}
      />
      <div className="absolute inset-x-0 bottom-10 flex justify-center px-4">
        <div className="animate-fade-up flex items-center gap-3 rounded-2xl bg-[#1f2226] px-5 py-3.5 text-[#f3f3f1] shadow-lg dark:bg-[#2b2f36]">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              target ? 'bg-[#e2a23c] text-[#1b1306]' : 'bg-white/10 text-white/70'
            }`}
          >
            {target ? <UploadIcon size={19} /> : <LockIcon size={18} />}
          </span>
          <div>
            <p className="text-md font-semibold">{target ? t('drop.title') : t('drop.readOnlyTitle')}</p>
            <p className="text-sm text-white/70">
              {target ? t('drop.into', { folder: target.label }) : t('drop.readOnlyHint')}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
