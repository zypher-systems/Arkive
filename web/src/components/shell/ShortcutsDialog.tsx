import { Modal } from '../ui/Modal';
import { Kbd } from '../ui/Card';
import { KeyboardIcon } from '../icons';
import { isMac } from '../../lib/hooks';
import { useI18n, type TKey } from '../../i18n';

const MOD = isMac ? '⌘' : 'Ctrl';

const GROUPS: { title: TKey; items: [string[], TKey][] }[] = [
  {
    title: 'shortcuts.general',
    items: [
      [[MOD, 'K'], 'shortcuts.search'],
      [['?'], 'shortcuts.help'],
      [['Esc'], 'shortcuts.escape'],
    ],
  },
  {
    title: 'shortcuts.files',
    items: [
      [['↑', '↓'], 'shortcuts.move'],
      [['Shift', '↑/↓'], 'shortcuts.extend'],
      [['Enter'], 'shortcuts.open'],
      [['Space'], 'shortcuts.toggle'],
      [[MOD, 'A'], 'shortcuts.selectAll'],
      [['F2'], 'shortcuts.rename'],
      [['Delete'], 'shortcuts.delete'],
      [[MOD, 'C'], 'shortcuts.copy'],
      [[MOD, 'V'], 'shortcuts.paste'],
      [['Shift', 'N'], 'shortcuts.newFolder'],
      [['i'], 'shortcuts.details'],
      [['Backspace'], 'shortcuts.up'],
    ],
  },
  {
    title: 'shortcuts.viewer',
    items: [
      [['←', '→'], 'shortcuts.prevNext'],
      [['+', '−'], 'shortcuts.zoom'],
      [['0'], 'shortcuts.zoomReset'],
      [[MOD, 'S'], 'shortcuts.save'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('shortcuts.title')} icon={<KeyboardIcon size={17} />} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-2xs font-semibold tracking-wider text-faint uppercase">{t(g.title)}</h3>
            <dl className="divide-y divide-line">
              {g.items.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-sm text-ink">{t(label)}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
