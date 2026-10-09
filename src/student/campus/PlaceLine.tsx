import { MapPin } from 'lucide-react';
import { placeDetailLine, resolveCampusLocation } from './resolveCampusLocation';

/**
 * Where something is, in the student's words: the building on the first line and «Salón 3304 · Tercer piso» under it.
 * An unknown place shows its original text untouched. Purely presentational.
 */
export default function PlaceLine({ location, strong = true, className = '' }: { location: string; strong?: boolean; className?: string }) {
  const place = resolveCampusLocation(location);
  const detail = place.resolved ? placeDetailLine(place) : null;
  return (
    <span className={`flex min-w-0 items-start gap-1.5 ${className}`}>
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
      <span className="min-w-0 break-words">
        <span className={strong ? 'font-bold text-ink' : 'font-semibold'}>{place.resolved ? place.building : place.original}</span>
        {detail && <span className="block text-ink-muted">{detail}</span>}
      </span>
    </span>
  );
}
