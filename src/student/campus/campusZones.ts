/**
 * Campus zones of Universidad Anáhuac Cancún for the student map.
 *
 * Geometry is traced (by hand, in pixels) over the most recent aerial photograph of the campus, oriented with the
 * main entrance at the bottom so the map reads top-to-bottom on a phone. Names, codes and pin colours follow the
 * official printed map («Mapa Uni Actualizado 2026»), so the student recognises the same «1, 2, 3, 4, AD, CM, LB…».
 *
 * Only what both sources show is drawn. Interiors are never drawn: a zone stops at the building.
 * To add or rename a place, edit THIS file (and its aliases); nothing else in the app knows building names.
 */
export type CampusZoneId =
  | 'entrada'
  | 'aulas'
  | 'rectoria'
  | 'medios'
  | 'cafeteria'
  | 'cordon'
  | 'negocios'
  | 'negocios2'
  | 'laboratorios'
  | 'medico'
  | 'gimnasio'
  | 'tenis'
  | 'futbol7'
  | 'coliseo'
  | 'iglesia'
  | 'plazaNaciones'
  | 'plazaSJP'
  | 'estSolar'
  | 'estColiseo';

export type ZoneKind = 'building' | 'sports' | 'plaza' | 'parking' | 'access' | 'service';

/** Photo-pixel coordinates (see header). Rect = x, y, width, height. */
export type Shape = { rect: [number, number, number, number] } | { points: Array<[number, number]> };

export type CampusZone = {
  id: CampusZoneId;
  /** Human name, as printed on the official map. */
  name: string;
  /** Short name for tight places (chips, lists). */
  short: string;
  /** Code of the official map pin («1», «AD», «D4»…). */
  code: string;
  /** Pin colour of the official map, for recognition. Text on it is `pinInk`. */
  pin: string;
  pinInk: string;
  kind: ZoneKind;
  /** One line about what is there (from the official map's directory). */
  description: string;
  shapes: Shape[];
  /** Where the pin / beacon sits. */
  anchor: [number, number];
  /** Zones drawn on another zone's footprint (e.g. the cafeteria inside the media centre complex). */
  sharesFootprintWith?: CampusZoneId;
  /**
   * Prefixes (accent/case-insensitive) that a session location may START with to belong to this zone, e.g.
   * «Negocios 3304, Tercer piso». The longest matching prefix wins.
   */
  aliases: string[];
};

/** Visible area of the map, in photo pixels: x, y, width, height. */
export const MAP_VIEWBOX = { x: 420, y: 40, w: 1050, h: 1460 } as const;

export const CAMPUS_ZONES: CampusZone[] = [
  {
    id: 'aulas', name: 'Edificio de Aulas', short: 'Aulas', code: '1', pin: '#D6338A', pinInk: '#FFFFFF', kind: 'building',
    description: 'Salones 121–135, Sala de Juicios Orales, Salón Sutton, Clínica de Fisioterapia y talleres.',
    shapes: [{ rect: [550, 712, 82, 223] }], anchor: [591, 800],
    aliases: ['1', 'Edificio 1', 'Edificio de Aulas', 'Aulas'],
  },
  {
    id: 'rectoria', name: 'Administración · Rectoría', short: 'Rectoría', code: 'AD', pin: '#8C1C2B', pinInk: '#FFFFFF', kind: 'building',
    description: 'Rectoría, CASA (servicios al alumnado) y Auditorio San Juan Pablo II.',
    shapes: [{ rect: [692, 730, 68, 140] }], anchor: [726, 790],
    aliases: ['Rectoría', 'Administración', 'Auditorio San Juan Pablo II'],
  },
  {
    id: 'medios', name: 'Centro de Medios', short: 'Medios', code: 'CM', pin: '#6B3A8E', pinInk: '#FFFFFF', kind: 'building',
    description: 'Laboratorios de VFX, post-producción, foto, audio, diseño y animación; foro y sala en vivo.',
    shapes: [{ points: [[535, 575], [645, 575], [645, 690], [560, 690], [560, 632], [535, 632]] }], anchor: [608, 615],
    aliases: ['Media Center', 'Centro de Medios'],
  },
  {
    id: 'cafeteria', name: 'Cafetería · Oxxo · Starbucks', short: 'Cafetería', code: 'C', pin: '#5A3A22', pinInk: '#FFFFFF', kind: 'service',
    description: 'Cafetería, Oxxo y Starbucks, junto al Centro de Medios.',
    shapes: [], anchor: [548, 650], sharesFootprintWith: 'medios',
    aliases: ['Cafetería', 'Oxxo', 'Starbucks'],
  },
  {
    id: 'cordon', name: 'Edificio Le Cordon Bleu', short: 'Le Cordon Bleu', code: '2', pin: '#22336B', pinInk: '#FFFFFF', kind: 'building',
    description: 'Salones 220–239, cocinas, Salón Sommelier, Hospitality Lab y Tourism Virtual Lab.',
    shapes: [{ rect: [650, 220, 90, 180] }], anchor: [695, 290],
    aliases: ['Le Cordon Bleu', 'Cordon Bleu', 'Edificio 2', 'Edificio Le Cordon Bleu'],
  },
  {
    id: 'negocios', name: 'Escuela Internacional de Negocios', short: 'Negocios', code: '3', pin: '#E8611A', pinInk: '#FFFFFF', kind: 'building',
    description: 'Salones 321–347 y 3101–3305, GENERA, CIDEA, coworking, salas ALPHA y cómputo.',
    shapes: [{ rect: [760, 135, 90, 240] }], anchor: [805, 240],
    aliases: ['Negocios', 'Escuela Internacional de Negocios', 'Edificio 3', 'Edificio de la Escuela Internacional de Negocios'],
  },
  {
    id: 'negocios2', name: 'Edificio de Negocios 2da Etapa', short: 'Negocios 2da Etapa', code: '4', pin: '#19A68C', pinInk: '#FFFFFF', kind: 'building',
    description: 'Salones 431–443, Zona de Convivencia, laboratorio de 4D e IA y Artes Escénicas.',
    shapes: [{ rect: [953, 237, 87, 143] }], anchor: [996, 300],
    aliases: ['Negocios 2da Etapa', 'Negocios 2a Etapa', 'Negocios Segunda Etapa', 'Edificio de Negocios 2da Etapa', 'Edificio 4'],
  },
  {
    id: 'laboratorios', name: 'Laboratorios', short: 'Laboratorios', code: 'LB', pin: '#F0A01E', pinInk: '#1A1A1A', kind: 'building',
    description: 'Laboratorios de ingeniería, medicina y odontología; clínicas de psicología y dental.',
    shapes: [{ rect: [448, 1025, 57, 305] }], anchor: [476, 1150],
    aliases: ['Laboratorios', 'Edificio de Laboratorios'],
  },
  {
    id: 'medico', name: 'Servicio Médico', short: 'Servicio Médico', code: '+', pin: '#B32025', pinInk: '#FFFFFF', kind: 'service',
    description: 'Atención médica, en el extremo del edificio de Laboratorios.',
    shapes: [{ rect: [448, 1345, 57, 105] }], anchor: [476, 1395],
    aliases: ['Servicio Médico', 'Enfermería'],
  },
  {
    id: 'gimnasio', name: 'Lions Sports Center', short: 'Gimnasio', code: 'D3', pin: '#8FC3E6', pinInk: '#10243A', kind: 'sports',
    description: 'Gimnasio y vestidores.',
    shapes: [{ rect: [700, 1053, 118, 137] }], anchor: [759, 1115],
    aliases: ['Lions Sports Center', 'Gimnasio', 'Gimnasio y Vestidores'],
  },
  {
    id: 'tenis', name: 'Cancha de Tenis', short: 'Tenis', code: 'D2', pin: '#8FC3E6', pinInk: '#10243A', kind: 'sports',
    description: 'Canchas de tenis, junto al gimnasio.',
    shapes: [{ rect: [705, 1190, 113, 108] }], anchor: [761, 1244],
    aliases: ['Cancha de Tenis'],
  },
  {
    id: 'futbol7', name: 'Cancha de Fútbol 7', short: 'Fútbol 7', code: 'D1', pin: '#8FC3E6', pinInk: '#10243A', kind: 'sports',
    description: 'Cancha de fútbol 7.',
    shapes: [{ rect: [545, 1340, 165, 115] }], anchor: [627, 1397],
    aliases: ['Cancha de Fútbol 7'],
  },
  {
    id: 'coliseo', name: 'Coliseo Maya', short: 'Coliseo Maya', code: 'D4', pin: '#8FC3E6', pinInk: '#10243A', kind: 'sports',
    description: 'Campo principal con gradas techadas.',
    shapes: [{ rect: [1052, 1170, 370, 232] }, { rect: [1108, 1135, 265, 50] }], anchor: [1237, 1286],
    aliases: ['Coliseo Maya', 'Coliseo'],
  },
  {
    id: 'iglesia', name: 'Iglesia Universitaria Santa María de Guadalupe', short: 'Iglesia', code: '✝', pin: '#2E6E9E', pinInk: '#FFFFFF', kind: 'building',
    description: 'Iglesia universitaria y su capilla, rodeada de jardines.',
    shapes: [{
      points: [[1060, 770], [1100, 770], [1100, 790], [1150, 790], [1150, 810], [1180, 810], [1180, 862], [1150, 862], [1150, 875], [1040, 875], [1040, 790], [1060, 790]],
    }],
    anchor: [1095, 830],
    aliases: ['Iglesia Universitaria Santa María de Guadalupe', 'Iglesia Universitaria', 'Iglesia', 'Capilla'],
  },
  {
    id: 'plazaNaciones', name: 'Plaza de las Naciones', short: 'Plaza de las Naciones', code: '◎', pin: '#2B2B2B', pinInk: '#FFFFFF', kind: 'plaza',
    description: 'Jardines frente a Le Cordon Bleu y Negocios.',
    shapes: [{ rect: [652, 428, 138, 170] }], anchor: [721, 512],
    aliases: ['Plaza de las Naciones'],
  },
  {
    id: 'plazaSJP', name: 'Plaza San Juan Pablo II', short: 'Plaza SJP II', code: '⌂', pin: '#3A3A3A', pinInk: '#FFFFFF', kind: 'plaza',
    description: 'Plaza entre Rectoría y la Iglesia.',
    shapes: [{ rect: [860, 792, 54, 72] }], anchor: [887, 828],
    aliases: ['Plaza San Juan Pablo II', 'Plaza Juan Pablo II'],
  },
  {
    id: 'entrada', name: 'Entrada al campus', short: 'Entrada', code: '⇧', pin: '#231F20', pinInk: '#FFFFFF', kind: 'access',
    description: 'Acceso principal: el bulevar sube hasta la glorieta.',
    shapes: [{ rect: [860, 1385, 60, 110] }], anchor: [890, 1445],
    aliases: ['Entrada al campus', 'Entrada principal', 'Entrada'],
  },
  {
    id: 'estSolar', name: 'Estacionamiento de paneles solares', short: 'Estacionamiento', code: 'E', pin: '#FFFFFF', pinInk: '#B32025', kind: 'parking',
    description: 'Estacionamiento techado con paneles solares, junto a Aulas y Le Cordon Bleu.',
    shapes: [{ points: [[432, 62], [630, 62], [630, 540], [545, 540], [545, 958], [432, 958]] }], anchor: [500, 330],
    aliases: [],
  },
  {
    id: 'estColiseo', name: 'Estacionamiento del Coliseo', short: 'Estacionamiento', code: 'E', pin: '#FFFFFF', pinInk: '#B32025', kind: 'parking',
    description: 'Estacionamiento junto a la glorieta, la Iglesia y el Coliseo Maya.',
    shapes: [{ rect: [1035, 940, 407, 165] }], anchor: [1240, 1022],
    aliases: [],
  },
];

/**
 * Space rules: more specific than a zone alias, checked first. Each one names the building word(s) written in the
 * location («Negocios») and the space that follows it; only the building word is consumed, so the space stays as the
 * detail («Arts Lab · Primer piso»).
 * - `zoneId` set   → the official map places that space in another building than the general alias says.
 * - `zoneId: null` → evidence is not conclusive: the place is shown as «por confirmar» (whole campus, no pin) instead
 *                    of guessing a building.
 */
export type SpaceRule = { building: string; space: string; zoneId: CampusZoneId | null; evidence: string };

export const SPACE_RULES: SpaceRule[] = [
  {
    building: 'Negocios', space: 'Arts Lab', zoneId: 'negocios2',
    evidence: 'Plano oficial 2026: «Laboratorio de Artes Escénicas» pertenece al Edificio de Negocios 2da Etapa (4).',
  },
  {
    building: 'Negocios', space: 'Planta baja - Zona de descanso', zoneId: null,
    evidence: 'El plano muestra una «Zona de Convivencia» en el edificio 4, pero no prueba que sea la misma «Zona de descanso».',
  },
];

export const ZONE_BY_ID = new Map(CAMPUS_ZONES.map((z) => [z.id, z])) as Map<CampusZoneId, CampusZone>;

/** The footprint a zone is drawn with (its own, or the one it shares). */
export const footprintOf = (zone: CampusZone) => (zone.sharesFootprintWith ? ZONE_BY_ID.get(zone.sharesFootprintWith)! : zone);

/** Decorative scenery (never interactive): roads, the roundabout, walkways and the forest. Same photo coordinates. */
export const SCENERY = {
  roads: [
    'M890 1500 L890 1044',
    'M850 1012 C780 1030 600 1036 520 1000 C468 976 452 940 452 880 L452 60',
    'M932 1006 L1036 1006',
  ],
  roundabout: { cx: 890, cy: 1003, r: 44 },
  walkways: ['M798 962 L798 412', 'M646 412 L960 412', 'M862 978 L798 960', 'M646 412 L646 700'],
  forests: [
    'M810 440 Q900 415 1040 432 Q1150 470 1205 560 Q1235 640 1190 712 Q1140 745 1040 742 Q995 790 980 900 Q955 950 915 944 Q895 860 885 790 Q835 770 815 700 Q795 560 810 440 Z',
    'M1070 150 Q1220 130 1330 240 Q1410 340 1400 520 Q1330 560 1250 540 Q1180 470 1110 425 Q1068 380 1065 300 Z',
  ],
} as const;
