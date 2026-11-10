/**
 * Profil wysokości trasy na osi czasu pamiątki: sam wykres z zarysu śladu (`TimelinePoint.walk.profile`), bez godzin
 * i znaczników — te są na karcie punktu (`TrackProfile`). Zwykłe SVG, więc wychodzi też w druku.
 */
export function WalkProfile({ profile, minEle, maxEle }: { profile: { km: number; ele: number }[]; minEle: number; maxEle: number }) {
  const W = 420;
  const H = 140;
  const pad = { left: 48, right: 10, top: 16, bottom: 22 };
  const total = Math.max(profile.at(-1)?.km ?? 0, 0.1);
  const lo = minEle;
  const hi = Math.max(maxEle, lo + 50);
  const x = (km: number) => Math.round((pad.left + (km / total) * (W - pad.left - pad.right)) * 10) / 10;
  const y = (ele: number) => Math.round((pad.top + (1 - (ele - lo) / (hi - lo)) * (H - pad.top - pad.bottom)) * 10) / 10;
  const path = profile.map((point, i) => `${i === 0 ? "M" : "L"}${x(point.km)},${y(point.ele)}`).join(" ");
  const area = `${path} L${x(profile.at(-1)!.km)},${H - pad.bottom} L${x(profile[0]!.km)},${H - pad.bottom} Z`;
  const step = total > 30 ? 10 : total > 12 ? 5 : total > 5 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  const top = profile.reduce((best, point) => (point.ele > best.ele ? point : best), profile[0]!);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full break-inside-avoid" role="img" aria-label={`Profil wysokości: od ${minEle} do ${maxEle} m n.p.m.`}>
      <path d={area} fill="#2E7D74" fillOpacity="0.18" />
      <path d={path} fill="none" stroke="#2E7D74" strokeWidth="2" />
      <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="currentColor" strokeOpacity="0.25" />
      {[lo, hi].map((ele) => (
        <text key={ele} x={pad.left - 6} y={y(ele) + 4} textAnchor="end" fontSize="12" fill="currentColor" fillOpacity="0.6">
          {Math.round(ele)} m
        </text>
      ))}
      {ticks.map((km) => (
        <text key={km} x={x(km)} y={H - 6} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.6">
          {km} km
        </text>
      ))}
      <circle cx={x(top.km)} cy={y(top.ele)} r="3.5" fill="#E2622B" />
      <text x={Math.min(x(top.km), W - 60)} y={Math.max(y(top.ele) - 6, 10)} fontSize="12" fill="#E2622B" textAnchor="middle">
        {top.ele} m
      </text>
    </svg>
  );
}
