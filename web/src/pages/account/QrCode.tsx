import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Inline SVG QR code. Drawn dark-on-white regardless of theme so phone
 * cameras can always scan it.
 */
export function QrCode({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 3;
  const total = count + quiet * 2;
  return (
    <div className="inline-flex rounded-xl bg-white p-2 shadow-sm ring-1 ring-line">
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
        shapeRendering="crispEdges"
        className="text-[#111317]"
      >
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
