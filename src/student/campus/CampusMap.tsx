import { useId, type KeyboardEvent } from 'react';
import { CAMPUS_ZONES, footprintOf, MAP_VIEWBOX as VB, SCENERY, ZONE_BY_ID, type CampusZone, type CampusZoneId, type Shape } from './campusZones';

export type MapMarker = {
  zoneId: CampusZoneId;
  /** «1», «2·3»… */
  label: string;
  /** The student's next mission: brand colour + beacon. */
  next?: boolean;
};

const FOCUS_SCALE = 1.75;

/** Pin/label sizes are in map units but kept constant on screen (drawn outside the zoomed group). */
const PIN_R = 38;

function shapeEl(shape: Shape, key: string, className: string) {
  if ('rect' in shape) {
    const [x, y, w, h] = shape.rect;
    return <rect key={key} x={x} y={y} width={w} height={h} rx={8} className={className} />;
  }
  return <polygon key={key} points={shape.points.map((p) => p.join(',')).join(' ')} className={className} />;
}

/**
 * Size of a route marker for its label («2», «1·3», «1·2·3·4»): the pill grows with the label and the type gets a bit
 * smaller for long groups, so up to four numbers stay inside and readable. Widths are estimated from the display
 * font's advance (digits ≈ 0.64em, «·» ≈ 0.34em), plus padding.
 */
export function markerMetrics(label: string) {
  const digits = label.replace(/[^0-9]/g, '').length;
  const dots = label.length - digits;
  const fontSize = label.length <= 1 ? 40 : label.length <= 3 ? 36 : 30;
  const textWidth = digits * 0.64 * fontSize + dots * 0.34 * fontSize;
  const height = 84;
  const width = Math.max(height, Math.ceil(textWidth + 44));
  return { width, height, fontSize };
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Transform that keeps `focus` near the upper-middle of the frame without ever showing empty space. */
function focusTransform(focus: CampusZone | null) {
  if (!focus) return { s: 1, tx: 0, ty: 0 };
  const s = FOCUS_SCALE;
  const [cx, cy] = focus.anchor;
  const tx = clamp(VB.x + VB.w / 2 - s * cx, VB.x + VB.w - s * (VB.x + VB.w), VB.x - s * VB.x);
  const ty = clamp(VB.y + VB.h * 0.45 - s * cy, VB.y + VB.h - s * (VB.y + VB.h), VB.y - s * VB.y);
  return { s, tx, ty };
}

/**
 * The campus drawn as a real top-down plan (traced from the aerial photo) with the official map's pins.
 * Buildings are the interactive targets (role=button, keyboard, aria-pressed); scenery is decorative.
 * `focus` zooms smoothly onto a building; pins, markers, labels and the destination beacon keep a constant on-screen
 * size because they are drawn outside the zoomed group. The «trail» is a visual reference between destinations,
 * never a walking route.
 */
export default function CampusMap({
  selected,
  onSelect,
  focus = null,
  destination = null,
  markers = [],
  trail = [],
  withMissions = new Set<CampusZoneId>(),
  className = '',
}: {
  selected: CampusZoneId | null;
  onSelect: (zoneId: CampusZoneId) => void;
  focus?: CampusZoneId | null;
  destination?: CampusZoneId | null;
  markers?: MapMarker[];
  trail?: CampusZoneId[];
  withMissions?: Set<CampusZoneId>;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const focusZone = focus ? ZONE_BY_ID.get(focus) ?? null : null;
  const { s, tx, ty } = focusTransform(focusZone);
  const at = ([x, y]: readonly [number, number]) => [s * x + tx, s * y + ty] as const;
  const selectedFootprint = selected ? footprintOf(ZONE_BY_ID.get(selected)!).id : null;
  const destinationFootprint = destination ? footprintOf(ZONE_BY_ID.get(destination)!).id : null;
  const markerZones = new Set(markers.map((m) => m.zoneId));

  const onKey = (zoneId: CampusZoneId) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(zoneId);
    }
  };

  const zoneClass = (zone: CampusZone) => {
    const fp = zone.id;
    const isSelected = selectedFootprint === fp || (selected && ZONE_BY_ID.get(selected)?.sharesFootprintWith === fp);
    const isDestination = destinationFootprint === fp;
    const mine = withMissions.has(zone.id) || [...withMissions].some((z) => ZONE_BY_ID.get(z)?.sharesFootprintWith === fp);
    return [
      'campus-zone',
      `campus-zone--${zone.kind}`,
      mine ? 'is-mine' : '',
      isSelected ? 'is-selected' : '',
      isDestination ? 'is-destination' : '',
    ].join(' ');
  };

  const trailPoints = trail
    .map((z) => ZONE_BY_ID.get(z))
    .filter((z): z is CampusZone => !!z)
    .map((z) => at(z.anchor));

  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={`campus-map block h-full w-full select-none ${className}`}
      role="group"
      aria-label="Mapa del campus. Toca o selecciona un edificio para ver qué hay ahí."
    >
      <defs>
        <clipPath id={`clip${id}`}>
          <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} rx={28} />
        </clipPath>
        <marker id={`arrow${id}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="campus-trail-head" />
        </marker>
      </defs>

      <g clipPath={`url(#clip${id})`}>
        <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} className="campus-ground" />

        {/* zoomable plan */}
        <g className="campus-plan" style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
          <g aria-hidden>
            {SCENERY.forests.map((d, i) => <path key={i} d={d} className="campus-forest" />)}
            {SCENERY.roads.map((d, i) => <path key={i} d={d} className="campus-road" />)}
            <circle cx={SCENERY.roundabout.cx} cy={SCENERY.roundabout.cy} r={SCENERY.roundabout.r} className="campus-road-ring" />
            <circle cx={SCENERY.roundabout.cx} cy={SCENERY.roundabout.cy} r={SCENERY.roundabout.r - 18} className="campus-roundabout" />
            {SCENERY.walkways.map((d, i) => <path key={i} d={d} className="campus-walkway" />)}
          </g>

          {CAMPUS_ZONES.filter((z) => z.shapes.length > 0).map((zone) => {
            const sharing = CAMPUS_ZONES.filter((z) => z.sharesFootprintWith === zone.id);
            const label = [zone.name, ...sharing.map((z) => z.name)].join(' y ');
            const pressed = selectedFootprint === zone.id || sharing.some((z) => z.id === selected);
            return (
              <g
                key={zone.id}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={pressed}
                className={zoneClass(zone)}
                onClick={() => onSelect(zone.id)}
                onKeyDown={onKey(zone.id)}
              >
                {zone.shapes.map((shape, i) => shapeEl(shape, `${zone.id}${i}`, 'campus-zone-shape'))}
              </g>
            );
          })}
        </g>

        {/* constant-size overlay: trail, pins, markers, beacon, label */}
        <g className="campus-overlay">
          {trailPoints.length > 1 && (
            <polyline
              points={trailPoints.map((p) => p.join(',')).join(' ')}
              className="campus-trail"
              markerMid={`url(#arrow${id})`}
              markerEnd={`url(#arrow${id})`}
              aria-hidden
            />
          )}

          {CAMPUS_ZONES.map((zone) => {
            if (markerZones.has(zone.id)) return null;
            const [x, y] = at(zone.anchor);
            const quiet = zone.kind === 'parking' || zone.kind === 'access';
            // With numbered route markers on screen, building codes become plain dots: only missions carry numbers.
            if (markers.length > 0) {
              return (
                <g key={zone.id} className="campus-pin is-dot" transform={`translate(${x} ${y})`} onClick={() => onSelect(zone.id)} aria-hidden>
                  <circle r={PIN_R + 14} className="campus-pin-hit" />
                  <circle r={13} fill={zone.pin} className="campus-pin-dot" />
                </g>
              );
            }
            return (
              <g key={zone.id} className={`campus-pin ${quiet ? 'is-quiet' : ''}`} transform={`translate(${x} ${y})`} onClick={() => onSelect(zone.id)} aria-hidden>
                <circle r={PIN_R + 14} className="campus-pin-hit" />
                <circle r={PIN_R} fill={zone.pin} className="campus-pin-dot" />
                <text textAnchor="middle" dominantBaseline="central" fill={zone.pinInk} fontSize={zone.code.length > 1 ? 30 : 38} className="campus-pin-text">
                  {zone.code}
                </text>
              </g>
            );
          })}

          {destination && (() => {
            const [x, y] = at(ZONE_BY_ID.get(destination)!.anchor);
            return (
              <g transform={`translate(${x} ${y})`} aria-hidden className="campus-beacon">
                <circle r={86} className="campus-beacon-ring anim-beacon" />
                <circle r={86} className="campus-beacon-ring anim-beacon anim-beacon-late" />
                <circle r={PIN_R + 12} className="campus-beacon-core" />
              </g>
            );
          })()}

          {markers.map((m) => {
            const [x, y] = at(ZONE_BY_ID.get(m.zoneId)!.anchor);
            const size = markerMetrics(m.label);
            return (
              <g
                key={m.zoneId}
                transform={`translate(${x} ${y})`}
                className={`campus-marker ${m.next ? 'is-next' : ''}`}
                onClick={() => onSelect(m.zoneId)}
                aria-hidden
              >
                {m.next && <circle r={80} className="campus-beacon-ring anim-beacon" />}
                <rect x={-size.width / 2} y={-size.height / 2} width={size.width} height={size.height} rx={size.height / 2} className="campus-marker-bg" />
                <text textAnchor="middle" dominantBaseline="central" fontSize={size.fontSize} className="campus-marker-text">
                  {m.label}
                </text>
              </g>
            );
          })}

          {focusZone && (() => {
            const target = destination ? ZONE_BY_ID.get(destination)! : focusZone;
            const [x, y] = at(target.anchor);
            const text = target.short;
            const width = Math.max(170, text.length * 22 + 56);
            const above = y > VB.y + 300;
            const ly = above ? y - 128 : y + 96;
            const lx = clamp(x, VB.x + width / 2 + 16, VB.x + VB.w - width / 2 - 16);
            return (
              <g transform={`translate(${lx} ${ly})`} aria-hidden className="campus-callout">
                <rect x={-width / 2} y={-34} width={width} height={68} rx={34} className="campus-callout-bg" />
                <text textAnchor="middle" dominantBaseline="central" fontSize={36} className="campus-callout-text">
                  {text}
                </text>
              </g>
            );
          })()}
        </g>
      </g>
    </svg>
  );
}
