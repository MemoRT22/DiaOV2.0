import { fold } from './csv';
import { rpc } from './adminApi';

/*
 * Descarga masiva de QR de talleres (solo Coordinación).
 *
 * Reutiliza la credencial vigente de cada actividad: un QR + código manual válidos para todos sus horarios. Aquí vive todo lo que no
 * toca la red ni el PDF: normalizar los metadatos, filtrar, agrupar por tallerista o división, contar lo que se va a producir y
 * armar la lista de control. Nada de esto contiene tokens: las credenciales llegan por separado (checkinExportRun.ts) y solo
 * viven en memoria mientras se produce el archivo.
 */

export type ExportMetaSession = { session_id: string; starts_at: string; ends_at: string; status: string; location: string | null };
export type ExportMetaDivision = { id: string; code: string; name: string };
export type ExportMetaCareer = { id: string; code: string; name: string; division_id: string };

/** Respuesta de `activity_export_metadata()`: metadatos de solo lectura, sin tokens ni códigos. */
export type ExportMeta = {
  activity_id: string;
  title: string;
  activity_type: string;
  experience_category: string | null;
  is_demo: boolean;
  location: string | null;
  building: string | null;
  room_space: string | null;
  facilitator_name: string | null;
  facilitator_email: string | null;
  has_credential: boolean;
  credential_rotated_at: string | null;
  divisions: ExportMetaDivision[];
  careers: ExportMetaCareer[];
  sessions: ExportMetaSession[];
};

export const fetchExportMetadata = () => rpc<ExportMeta[]>('activity_export_metadata');

/** Valor de filtro para «sin división / sin responsable». */
export const NONE = '__none__';

export type ExportKind = 'academica' | 'vida_universitaria';

export type ExportSession = { id: string; startsAt: string; endsAt: string; location: string | null };

export type ExportWorkshop = {
  id: string;
  title: string;
  kind: ExportKind;
  isDemo: boolean;
  /** Lugar para mostrar: edificio y espacio de la propuesta o, si no hay, la ubicación de la actividad. */
  place: string;
  building: string | null;
  divisions: ExportMetaDivision[];
  careers: ExportMetaCareer[];
  responsible: { name: string | null; email: string | null } | null;
  /** Clave estable del destinatario: correo, o nombre normalizado cuando no hay correo; NONE sin responsable. */
  responsibleKey: string;
  /** Horarios vigentes (estado «activa»), ordenados. Los cancelados y ocultos no cuentan. */
  sessions: ExportSession[];
  hasCredential: boolean;
  credentialRotatedAt: string | null;
};

/** Por qué un taller no puede producirse (se informa, nunca se omite en silencio). */
export type Exclusion = 'sin-horarios' | 'sin-credencial';
export const EXCLUSION_TEXT: Record<Exclusion, string> = {
  'sin-horarios': 'Sin horarios vigentes (cancelado u oculto): no se exporta',
  'sin-credencial': 'Sin credencial: no se puede exportar. Genérala desde Check-in, no desde esta pantalla',
};

export const exclusionOf = (workshop: ExportWorkshop): Exclusion | null =>
  workshop.sessions.length === 0 ? 'sin-horarios' : !workshop.hasCredential ? 'sin-credencial' : null;

const clean = (value: string | null | undefined) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
};

export const KIND_LABEL: Record<ExportKind, string> = { academica: 'Académica', vida_universitaria: 'Vida Universitaria' };
export const VIDA_GROUP = '__vida__';

/** Convierte los metadatos del servidor en talleres listos para filtrar. No inventa asociaciones: lo que no existe queda vacío. */
export function normalizeWorkshops(meta: ExportMeta[]): ExportWorkshop[] {
  return meta.map((item) => {
    const email = clean(item.facilitator_email)?.toLowerCase() ?? null;
    const name = clean(item.facilitator_name);
    const building = clean(item.building);
    const room = clean(item.room_space);
    const place = [building, room].filter(Boolean).join(' ') || clean(item.location) || '';
    return {
      id: item.activity_id,
      title: clean(item.title) ?? 'Taller sin nombre',
      // «liderazgo» es el valor heredado de Vida Universitaria.
      kind: item.activity_type === 'academica' ? 'academica' : 'vida_universitaria',
      isDemo: item.is_demo,
      place,
      building,
      divisions: item.divisions ?? [],
      careers: item.careers ?? [],
      responsible: name || email ? { name, email } : null,
      responsibleKey: email ?? (name ? `nombre:${fold(name)}` : NONE),
      sessions: (item.sessions ?? [])
        .filter((session) => session.status === 'activa')
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((session) => ({ id: session.session_id, startsAt: session.starts_at, endsAt: session.ends_at, location: clean(session.location) })),
      hasCredential: item.has_credential,
      credentialRotatedAt: item.credential_rotated_at,
    };
  });
}

export type ExportFilters = {
  /** DEMO apagado por defecto: la exportación oficial usa solo talleres reales. */
  includeDemo: boolean;
  /** Vacío = todas. Puede incluir NONE («sin división»). */
  divisionIds: string[];
  careerIds: string[];
  /** Claves de destinatario (ver `responsibleKey`); puede incluir NONE. */
  responsibleKeys: string[];
  workshopIds: string[];
  kinds: ExportKind[];
  buildings: string[];
  search: string;
};

export const DEFAULT_FILTERS: ExportFilters = { includeDemo: false, divisionIds: [], careerIds: [], responsibleKeys: [], workshopIds: [], kinds: [], buildings: [], search: '' };

export const filtersActive = (filters: ExportFilters) =>
  filters.includeDemo || filters.divisionIds.length > 0 || filters.careerIds.length > 0 || filters.responsibleKeys.length > 0
  || filters.workshopIds.length > 0 || filters.kinds.length > 0 || filters.buildings.length > 0 || filters.search.trim() !== '';

export function applyFilters(workshops: ExportWorkshop[], filters: ExportFilters): ExportWorkshop[] {
  const search = fold(filters.search);
  return workshops.filter((workshop) => {
    if (workshop.isDemo && !filters.includeDemo) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(workshop.kind)) return false;
    if (filters.divisionIds.length > 0) {
      const ids = workshop.divisions.length > 0 ? workshop.divisions.map((division) => division.id) : [NONE];
      if (!ids.some((id) => filters.divisionIds.includes(id))) return false;
    }
    if (filters.careerIds.length > 0 && !workshop.careers.some((career) => filters.careerIds.includes(career.id))) return false;
    if (filters.responsibleKeys.length > 0 && !filters.responsibleKeys.includes(workshop.responsibleKey)) return false;
    if (filters.workshopIds.length > 0 && !filters.workshopIds.includes(workshop.id)) return false;
    if (filters.buildings.length > 0 && !(workshop.building && filters.buildings.includes(workshop.building))) return false;
    if (search && !fold(`${workshop.title} ${workshop.responsible?.name ?? ''} ${workshop.responsible?.email ?? ''} ${workshop.place}`).includes(search)) return false;
    return true;
  });
}

export type Option = { value: string; label: string; count: number };

const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'es-MX');

/** Opciones de cada filtro a partir de las asociaciones reales de los talleres visibles (según DEMO). */
export function filterOptions(workshops: ExportWorkshop[], includeDemo: boolean) {
  const pool = workshops.filter((workshop) => includeDemo || !workshop.isDemo);
  const tally = (pick: (workshop: ExportWorkshop) => { value: string; label: string }[]): Option[] => {
    const map = new Map<string, Option>();
    for (const workshop of pool) {
      for (const entry of pick(workshop)) {
        const option = map.get(entry.value) ?? { ...entry, count: 0 };
        option.count += 1;
        map.set(entry.value, option);
      }
    }
    return [...map.values()].sort(byLabel);
  };
  const divisions = tally((w) => (w.divisions.length > 0 ? w.divisions.map((d) => ({ value: d.id, label: d.name })) : [{ value: NONE, label: 'Sin división asignada' }]));
  // «Sin división» al final, como el resto de los «sin …».
  divisions.sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : 0) || byLabel(a, b));
  const careers = tally((w) => w.careers.map((c) => ({ value: c.id, label: c.name })));
  const responsibles = tally((w) => [{ value: w.responsibleKey, label: w.responsible ? (w.responsible.name ?? w.responsible.email ?? '') : 'Sin responsable' }]);
  responsibles.sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : 0) || byLabel(a, b));
  const buildings = tally((w) => (w.building ? [{ value: w.building, label: w.building }] : []));
  return { divisions, careers, responsibles, buildings };
}

// ---------- Formatos y plan ----------

export type ExportFormat = 'tallerista' | 'division' | 'general';
export const FORMAT_LABEL: Record<ExportFormat, string> = {
  tallerista: 'Un PDF por tallerista (ZIP)',
  division: 'PDFs por división (ZIP)',
  general: 'Concentrado general (un PDF)',
};

export type ExportDocument = {
  id: string;
  fileName: string;
  /** Subcarpeta dentro del ZIP (por ejemplo «Sin responsable»). */
  folder: string | null;
  title: string;
  /** Una página por taller, ordenadas. */
  workshops: ExportWorkshop[];
  recipient: { name: string | null; email: string | null } | null;
  /** Requiere revisión antes de enviarse (falta correo, responsable…). */
  review: string[];
};

export type ExportSummary = {
  /** Talleres que cumplen los filtros (incluye los que no se pueden producir). */
  matching: number;
  /** Talleres que sí se producen: son tantos QR como credenciales por obtener. */
  workshops: number;
  qrCount: number;
  /** Páginas totales (puede ser mayor que `workshops` por división, donde un taller aparece en varias). */
  pages: number;
  documents: number;
  recipients: number;
  groups: number;
  withoutResponsible: number;
  withoutEmail: number;
  withoutDivision: number;
  withoutCredential: number;
  withoutSessions: number;
  demo: number;
};

export type ExportPlan = {
  format: ExportFormat;
  /** Talleres que se producen, sin duplicados. */
  workshops: ExportWorkshop[];
  excluded: { workshop: ExportWorkshop; reason: Exclusion }[];
  documents: ExportDocument[];
  summary: ExportSummary;
};

const PREFIX = 'DiaOV2026_QR';

/** Texto seguro para nombres de archivo y carpetas: sin acentos ni símbolos, con guiones. */
export function slugify(value: string, max = 60) {
  const text = value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (text.slice(0, max).replace(/-+$/g, '')) || 'sin-nombre';
}

function uniqueNames(documents: ExportDocument[]) {
  const seen = new Map<string, number>();
  for (const document of documents) {
    const key = `${document.folder ?? ''}/${document.fileName.toLowerCase()}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) document.fileName = document.fileName.replace(/\.pdf$/, `-${count}.pdf`);
  }
}

const sortWorkshops = (list: ExportWorkshop[]) =>
  [...list].sort((a, b) => a.title.localeCompare(b.title, 'es-MX') || a.id.localeCompare(b.id));

/** Etiqueta de «división / área» para documentos y lista de control. */
export function areaLabel(workshop: ExportWorkshop) {
  if (workshop.divisions.length > 0) return workshop.divisions.map((division) => division.name).join(' · ');
  return workshop.kind === 'vida_universitaria' ? 'Vida Universitaria' : '';
}

const demoMark = (workshops: ExportWorkshop[]) => (workshops.length > 0 && workshops.every((workshop) => workshop.isDemo) ? '_DEMO' : '');

function byTallerista(workshops: ExportWorkshop[]): ExportDocument[] {
  const groups = new Map<string, ExportWorkshop[]>();
  const unassigned: ExportWorkshop[] = [];
  for (const workshop of workshops) {
    if (workshop.responsibleKey === NONE) unassigned.push(workshop);
    else groups.set(workshop.responsibleKey, [...(groups.get(workshop.responsibleKey) ?? []), workshop]);
  }
  const documents: ExportDocument[] = [...groups.entries()].map(([key, list]) => {
    const sorted = sortWorkshops(list);
    // Un mismo correo puede venir escrito con nombres distintos: se usa el primero que tenga nombre.
    const named = sorted.find((workshop) => workshop.responsible?.name)?.responsible?.name ?? null;
    const email = sorted.find((workshop) => workshop.responsible?.email)?.responsible?.email ?? null;
    const review: string[] = [];
    if (!email) review.push('Sin correo del responsable');
    if (!named) review.push('Sin nombre del responsable');
    return {
      id: `tallerista:${key}`,
      fileName: `${PREFIX}_${slugify(named ?? email ?? 'responsable')}${demoMark(sorted)}.pdf`,
      folder: null,
      title: named ?? email ?? 'Responsable',
      workshops: sorted,
      recipient: { name: named, email },
      review,
    };
  });
  documents.sort((a, b) => a.title.localeCompare(b.title, 'es-MX'));
  // Sin responsable no hay a quién enviarlo: un PDF por taller, aparte, para que Coordinación decida.
  const orphans: ExportDocument[] = sortWorkshops(unassigned).map((workshop) => ({
    id: `sin-responsable:${workshop.id}`,
    fileName: `${PREFIX}_${slugify(workshop.title)}${workshop.isDemo ? '_DEMO' : ''}.pdf`,
    folder: 'Sin responsable',
    title: workshop.title,
    workshops: [workshop],
    recipient: null,
    review: ['Sin responsable registrado'],
  }));
  const all = [...documents, ...orphans];
  uniqueNames(all);
  return all;
}

function byDivision(workshops: ExportWorkshop[]): ExportDocument[] {
  const groups = new Map<string, { label: string; rank: number; list: ExportWorkshop[] }>();
  const add = (key: string, label: string, rank: number, workshop: ExportWorkshop) => {
    const group = groups.get(key) ?? { label, rank, list: [] };
    group.list.push(workshop);
    groups.set(key, group);
  };
  for (const workshop of workshops) {
    if (workshop.divisions.length > 0) workshop.divisions.forEach((division) => add(division.id, division.name, 0, workshop));
    else if (workshop.kind === 'vida_universitaria') add(VIDA_GROUP, 'Vida Universitaria', 1, workshop);
    else add(NONE, 'Sin división asignada', 2, workshop);
  }
  const ranked = [...groups.entries()].map(([key, group]) => {
    const sorted = sortWorkshops(group.list);
    const document: ExportDocument = {
      id: `division:${key}`,
      fileName: `${PREFIX}_${key === NONE ? 'Sin-division' : slugify(group.label)}${demoMark(sorted)}.pdf`,
      folder: null,
      title: group.label,
      workshops: sorted,
      recipient: null,
      review: key === NONE ? ['Talleres sin división asignada'] : [],
    };
    return { document, rank: group.rank };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.document.title.localeCompare(b.document.title, 'es-MX'));
  const documents = ranked.map((entry) => entry.document);
  uniqueNames(documents);
  return documents;
}

function general(workshops: ExportWorkshop[]): ExportDocument[] {
  if (workshops.length === 0) return [];
  // Orden de impresión: por área y, dentro de ella, por nombre.
  const sorted = [...workshops].sort((a, b) =>
    areaLabel(a).localeCompare(areaLabel(b), 'es-MX') || a.title.localeCompare(b.title, 'es-MX') || a.id.localeCompare(b.id));
  return [{ id: 'general', fileName: `${PREFIX}_Concentrado${demoMark(sorted)}.pdf`, folder: null, title: 'Concentrado general', workshops: sorted, recipient: null, review: [] }];
}

export function singleWorkshopDocument(workshop: ExportWorkshop): ExportDocument {
  return {
    id: `taller:${workshop.id}`,
    fileName: `${PREFIX}_${slugify(workshop.title)}${workshop.isDemo ? '_DEMO' : ''}.pdf`,
    folder: null,
    title: workshop.title,
    workshops: [workshop],
    recipient: workshop.responsible,
    review: [],
  };
}

/** Lo que se produciría con estos talleres y este formato. Se calcula antes de pedir una sola credencial. */
export function buildPlan(selected: ExportWorkshop[], format: ExportFormat): ExportPlan {
  const excluded: ExportPlan['excluded'] = [];
  const workshops: ExportWorkshop[] = [];
  const seen = new Set<string>();
  for (const workshop of selected) {
    if (seen.has(workshop.id)) continue; // una actividad = un QR, aunque tenga varias carreras, divisiones u horarios
    seen.add(workshop.id);
    const reason = exclusionOf(workshop);
    if (reason) excluded.push({ workshop, reason });
    else workshops.push(workshop);
  }
  const documents = format === 'tallerista' ? byTallerista(workshops) : format === 'division' ? byDivision(workshops) : general(workshops);
  const recipients = new Set(documents.filter((document) => document.recipient).map((document) => document.recipient?.email ?? document.id));
  const noEmail = workshops.filter((workshop) => workshop.responsible && !workshop.responsible.email);
  return {
    format,
    workshops,
    excluded,
    documents,
    summary: {
      matching: seen.size,
      workshops: workshops.length,
      qrCount: workshops.length,
      pages: documents.reduce((total, document) => total + document.workshops.length, 0),
      documents: documents.length,
      recipients: format === 'tallerista' ? recipients.size : 0,
      groups: format === 'division' ? documents.length : 0,
      withoutResponsible: workshops.filter((workshop) => !workshop.responsible).length,
      withoutEmail: noEmail.length,
      withoutDivision: workshops.filter((workshop) => workshop.divisions.length === 0 && workshop.kind === 'academica').length,
      withoutCredential: excluded.filter((entry) => entry.reason === 'sin-credencial').length,
      withoutSessions: excluded.filter((entry) => entry.reason === 'sin-horarios').length,
      demo: workshops.filter((workshop) => workshop.isDemo).length,
    },
  };
}

// ---------- Lista de control (CSV) ----------

export type ControlStatus = 'Listo' | 'Requiere revisión';

export type ControlRow = {
  workshop: ExportWorkshop;
  pdf: string;
  status: ControlStatus;
  notes: string[];
};

/** Una fila por taller con el PDF donde viaja. Sin tokens ni códigos manuales. `missing` = talleres cuyo QR no se pudo obtener. */
export function controlRows(plan: ExportPlan, missing: ReadonlySet<string> = new Set()): ControlRow[] {
  const rows: ControlRow[] = [];
  for (const document of plan.documents) {
    for (const workshop of document.workshops) {
      const notes: string[] = [];
      if (!workshop.responsible) notes.push('Sin responsable');
      else {
        if (!workshop.responsible.email) notes.push('Sin correo');
        if (!workshop.responsible.name) notes.push('Sin nombre del responsable');
      }
      if (workshop.divisions.length === 0 && workshop.kind === 'academica') notes.push('Sin división asignada');
      if (workshop.isDemo) notes.push('DEMO');
      if (missing.has(workshop.id)) notes.push('QR no obtenido: no está incluido en el PDF');
      const blocking = notes.filter((note) => note !== 'DEMO');
      rows.push({
        workshop,
        pdf: missing.has(workshop.id) ? '' : document.folder ? `${document.folder}/${document.fileName}` : document.fileName,
        status: blocking.length > 0 ? 'Requiere revisión' : 'Listo',
        notes,
      });
    }
  }
  for (const entry of plan.excluded) {
    rows.push({ workshop: entry.workshop, pdf: '', status: 'Requiere revisión', notes: [EXCLUSION_TEXT[entry.reason]] });
  }
  return rows.sort((a, b) =>
    (a.workshop.responsible?.email ?? '￿').localeCompare(b.workshop.responsible?.email ?? '￿') || a.workshop.title.localeCompare(b.workshop.title, 'es-MX'));
}

// Las hojas de cálculo ejecutan fórmulas que empiezan con = + - @: se neutralizan, como en el resto de las exportaciones.
const csvCell = (value: string | number) => {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: (string | number)[][]) =>
  `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

export function controlCsv(rows: ControlRow[]) {
  return toCsv(
    ['Taller', 'Responsable', 'Correo', 'División / área', 'Sesiones', 'PDF', 'Estado', 'Observaciones'],
    rows.map((row) => [
      row.workshop.title, row.workshop.responsible?.name ?? '', row.workshop.responsible?.email ?? '', areaLabel(row.workshop),
      row.workshop.sessions.length, row.pdf, row.status, row.notes.join('; '),
    ]),
  );
}

/** Destinatarios sin repetir (por correo): lo que se necesita para enviar un correo por responsable. */
export function recipientsCsv(plan: ExportPlan, missing: ReadonlySet<string> = new Set()) {
  const rows = plan.documents.filter((document) => document.recipient).map((document) => {
    const lacking = document.workshops.filter((workshop) => missing.has(workshop.id));
    const status = document.review.length > 0 || lacking.length > 0 ? 'Requiere revisión' : 'Listo';
    const notes = [...document.review, ...lacking.map((workshop) => `QR no obtenido: ${workshop.title}`)];
    return [
      document.recipient?.name ?? '', document.recipient?.email ?? '', document.workshops.map((workshop) => workshop.title).join('; '),
      document.workshops.reduce((total, workshop) => total + workshop.sessions.length, 0), lacking.length === document.workshops.length ? '' : document.fileName, status, notes.join('; '),
    ];
  });
  return toCsv(['Responsable', 'Correo', 'Talleres', 'Sesiones', 'PDF', 'Estado', 'Observaciones'], rows);
}
