import { CAMPUS_ZONES, type CampusZone, type CampusZoneId } from './campusZones';

/**
 * THE single place that turns a session location string (what the board already sends, e.g. «Negocios 3304, Tercer
 * piso») into something a student can walk to: which building (zone), which room/space and which floor.
 *
 * Rules
 * - A location belongs to a zone only when it STARTS with one of the zone's aliases (accent/case-insensitive, whole
 *   word). The longest alias wins, so «Negocios 2da Etapa…» never falls into «Negocios».
 * - Nothing is guessed: if no alias matches, the place is `resolved: false`, keeps its original text and the map
 *   shows the whole campus with a «no tenemos el punto exacto» notice.
 * - Floors are only read when written («, Tercer piso» or «Planta baja - …»); interiors are never invented.
 */
export type CampusPlace = {
  original: string;
  resolved: boolean;
  zoneId: CampusZoneId | null;
  zone: CampusZone | null;
  /** Human building name («Escuela Internacional de Negocios»), or null when unresolved. */
  building: string | null;
  /** Room or space inside the building («Salón 3304», «HUB de IA y Ciberseguridad»), when given. */
  detail: string | null;
  /** «Planta baja», «Tercer piso»…, when given. */
  floor: string | null;
};

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const FLOOR = '(planta baja|primer piso|segundo piso|tercer piso|cuarto piso|quinto piso|sotano|mezzanine)';
const FLOOR_SUFFIX = new RegExp(`,\\s*${FLOOR}\\s*$`, 'i');
const FLOOR_PREFIX = new RegExp(`^${FLOOR}\\s*[-–—:]\\s*`, 'i');

/** Aliases flattened and sorted longest-first once. */
const ALIASES = CAMPUS_ZONES.flatMap((zone) => zone.aliases.map((alias) => ({ zone, key: strip(alias), length: alias.length })))
  .sort((a, b) => b.key.length - a.key.length);

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Splits «<rest>, Tercer piso» / «Planta baja - <rest>» into the rest and the floor, using the ORIGINAL casing. */
function splitFloor(text: string): { rest: string; floor: string | null } {
  const plain = strip(text);
  const suffix = plain.match(FLOOR_SUFFIX);
  if (suffix) {
    const cut = text.lastIndexOf(',');
    return { rest: text.slice(0, cut).trim(), floor: capitalize(text.slice(cut + 1).trim().toLowerCase()) };
  }
  const prefix = plain.match(FLOOR_PREFIX);
  if (prefix) {
    const m = text.match(/^(.+?)\s*[-–—:]\s*(.*)$/);
    if (m) return { rest: m[2].trim(), floor: capitalize(m[1].trim().toLowerCase()) };
  }
  return { rest: text.trim(), floor: null };
}

const unmappedSeen = new Set<string>();

/** Development aid: every distinct location that did not resolve, once (also used by tests). */
export function reportUnmapped(original: string) {
  if (!original || unmappedSeen.has(original)) return;
  unmappedSeen.add(original);
  if (import.meta.env?.DEV && import.meta.env?.MODE !== 'test') console.info('[campus-map] ubicación sin punto en el mapa:', original);
}
export const unmappedLocations = () => [...unmappedSeen];

export function resolveCampusLocation(location: string | null | undefined): CampusPlace {
  const original = (location ?? '').trim();
  const empty: CampusPlace = { original, resolved: false, zoneId: null, zone: null, building: null, detail: null, floor: null };
  if (!original) return empty;

  const plain = strip(original);
  const hit = ALIASES.find(({ key }) => plain === key || plain.startsWith(`${key} `) || plain.startsWith(`${key},`));
  if (!hit) {
    reportUnmapped(original);
    return empty;
  }

  // Remove the alias (same number of words) from the original text, keeping the original casing of the rest.
  const words = hit.key.split(' ').length;
  const afterAlias = original.split(/\s+/).slice(words).join(' ').replace(/^,\s*/, '');
  const { rest, floor } = splitFloor(afterAlias);
  const zone = hit.zone;
  // «Cafetería Cafetería» → no detail; a bare room number reads better as «Salón 3304».
  const sameAsBuilding = !rest || strip(rest) === hit.key || strip(rest) === strip(zone.short) || strip(rest) === strip(zone.name);
  const detail = sameAsBuilding ? null : /^\d+[a-z]?$/i.test(rest) ? `Salón ${rest}` : rest;

  return { original, resolved: true, zoneId: zone.id, zone, building: zone.name, detail, floor };
}

/** «Salón 3304 · Tercer piso» (or null when there is nothing beyond the building). */
export function placeDetailLine(place: CampusPlace): string | null {
  const parts = [place.detail, place.floor].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** One-line human text: «Escuela Internacional de Negocios · Salón 3304 · Tercer piso», or the original text. */
export function formatPlace(location: string | null | undefined): string {
  const place = resolveCampusLocation(location);
  if (!place.resolved) return place.original;
  return [place.building, placeDetailLine(place)].filter(Boolean).join(' · ');
}
