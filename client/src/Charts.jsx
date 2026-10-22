import { Empty } from 'antd';

// กราฟวาดด้วย SVG ล้วน ไม่ต้องติดตั้งไลบรารีเพิ่ม
const compact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });
const full = (v) => Number(v).toLocaleString('th-TH');
const GRID = '#e6edf8';
const MUTED = '#6b7a99';

function niceMax(v, integer) {
  if (integer) return Math.max(4, Math.ceil(v / 4) * 4);
  if (v <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', justifyContent: 'center', marginTop: 8, fontSize: 12, color: MUTED }}>
      {items.map((s) => (
        <span key={s.key || s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * กราฟแท่ง (จัดกลุ่มได้)
 * data:   [{ label: 'ต.ค.', revenue: 5000, cost: 3200 }, ...]
 * series: [{ key: 'revenue', label: 'รายรับ', color: '#1a4fb8' }, ...]
 * integer: true เมื่อเป็นจำนวนนับ (แกน Y เป็นจำนวนเต็ม)
 */
export function BarChart({ data, series, integer = false, height = 220, unit = '' }) {
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  if (!data.length || values.every((v) => v === 0)) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีข้อมูลในช่วงนี้" />;
  }

  const W = 560;
  const H = height;
  const pad = { l: 44, r: 8, t: 14, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(...values), integer);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max * i) / 4);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const gw = iw / data.length;
  const bw = Math.min(30, (gw * 0.72) / series.length);
  const showValues = data.length <= 7;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={pad.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill={MUTED}>{compact.format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.l + gw * i + (gw - bw * series.length) / 2;
          return (
            <g key={d.label + i}>
              {series.map((s, j) => {
                const v = Number(d[s.key]) || 0;
                const h = (v / max) * ih;
                const x = x0 + bw * j;
                return (
                  <g key={s.key}>
                    {h > 0 && (
                      <rect x={x + 1} y={y(v)} width={bw - 2} height={h} rx="3" fill={s.color}>
                        <title>{`${d.label} · ${s.label}: ${full(v)}${unit}`}</title>
                      </rect>
                    )}
                    {showValues && v > 0 && (
                      <text x={x + bw / 2} y={y(v) - 4} fontSize="10" textAnchor="middle" fill={MUTED}>{compact.format(v)}</text>
                    )}
                  </g>
                );
              })}
              <text x={pad.l + gw * i + gw / 2} y={H - 8} fontSize="11" textAnchor="middle" fill={MUTED}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <Legend items={series} />}
    </div>
  );
}

/**
 * กราฟโดนัท + คำอธิบาย
 * data: [{ label: 'ใหม่', value: 3, color: '#c0392b' }, ...]
 */
export function Donut({ data, centerLabel = 'ทั้งหมด', size = 150 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีข้อมูลในช่วงนี้" />;

  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <svg viewBox="0 0 140 140" width={size} height={size} role="img">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef3fb" strokeWidth="18" />
        {data.filter((d) => d.value > 0).map((d) => {
          const len = (d.value / total) * c;
          const el = (
            <circle
              key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color} strokeWidth="18"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"
            >
              <title>{`${d.label}: ${full(d.value)} (${Math.round((d.value / total) * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="70" y="70" fontSize="24" fontWeight="700" textAnchor="middle" fill="#0b2a8a">{full(total)}</text>
        <text x="70" y="88" fontSize="10" textAnchor="middle" fill={MUTED}>{centerLabel}</text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, minWidth: 150 }}>
        {data.map((d) => (
          <li key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: 'inline-block', flex: 'none' }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <b>{full(d.value)}</b>
            <span style={{ color: MUTED, width: 40, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
