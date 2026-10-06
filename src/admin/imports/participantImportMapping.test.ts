import { describe, expect, it } from 'vitest';
import { mapColumns, parseCsv } from '../../lib/csv';
import { PARTICIPANT_COLUMNS, PARTICIPANT_TEMPLATE, buildParticipantRow, isDiscardedHeader } from './participantImportMapping';

const FORMS = [
  'Marca temporal,Nombre,Apellidos,Correo,Teléfono con WhatsApp,Escuela,Grado,Periodo,Licenciatura,¿Cómo te enteraste?',
  '04/10/2026 10:15:00,Ana María,López  Pérez,Ana@Ejemplo.com,998 123 4567,Colegio Ejemplo,3.º año,Agosto 2027,Psicología,Redes',
  '05/10/2026 09:00:00,Beto,Ruiz,beto@ejemplo.com,,Prepa Uno,Egresado,Enero 2028,DER,',
  '05/10/2026 09:30:00,Carla,Soto,carla@ejemplo.com,,Prepa Dos,quinto,Mayo 2030,Derecho,',
].join('\n');

const build = (csv: string) => {
  const mapping = mapColumns(parseCsv(csv), PARTICIPANT_COLUMNS, isDiscardedHeader);
  return { mapping, rows: mapping.rows.map((r, i) => buildParticipantRow(r, i + 2, mapping.extras[i] ?? [])) };
};

describe('importación del Forms oficial', () => {
  it('reconoce las columnas del Forms y exige solo Nombre y Correo', () => {
    const { mapping } = build(FORMS);
    expect(mapping.missing).toEqual([]);
    expect(mapping.matched.map((m) => m.column.key)).toEqual([
      'first_name', 'last_name', 'email', 'phone', 'high_school', 'grade', 'period', 'career', 'submitted_at',
    ]);
    expect(PARTICIPANT_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(['first_name', 'email']);
    // las preguntas que no son del padrón se conservan como información adicional
    expect(mapping.unknownHeaders).toEqual(['¿Cómo te enteraste?']);
  });

  it('une Nombre y Apellidos en un único nombre completo y normaliza grado y periodo', () => {
    const { rows } = build(FORMS);
    expect(rows[0]).toMatchObject({
      row: 2, email: 'Ana@Ejemplo.com', full_name: 'Ana María López Pérez', phone: '998 123 4567', high_school: 'Colegio Ejemplo',
      high_school_grade: '3', entry_period: '2027-08', career: 'Psicología',
    });
    expect(rows[1]).toMatchObject({ full_name: 'Beto Ruiz', high_school_grade: 'graduado', entry_period: '2028-01', career: 'DER' });
  });

  it('no envía fecha de nacimiento ni segunda carrera, aunque el archivo traiga esas columnas', () => {
    const csv = 'Nombre,Apellidos,Correo,Fecha de nacimiento,Segunda carrera de interés\nAna,López,ana@e.com,15/03/2008,Negocios';
    const { mapping, rows } = build(csv);
    expect(Object.keys(rows[0])).not.toContain('birth_date');
    expect(Object.keys(rows[0])).not.toContain('career_2');
    // la fecha no se guarda ni como información adicional; la segunda carrera sí queda como pregunta adicional del Forms
    expect(JSON.stringify(rows[0])).not.toContain('2008');
    expect(mapping.unknownHeaders).toEqual(['Segunda carrera de interés']);
    expect(PARTICIPANT_COLUMNS.map((c) => c.key)).not.toContain('birth_date');
    expect(PARTICIPANT_COLUMNS.map((c) => c.key)).not.toContain('career_2');
  });

  it('envía tal cual un grado o periodo que no reconoce: el servidor lo omite y avisa', () => {
    const { rows } = build(FORMS);
    expect(rows[2]).toMatchObject({ high_school_grade: 'quinto', entry_period: 'Mayo 2030' });
  });

  it('el aviso de privacidad y la marca temporal son opcionales', () => {
    const { mapping, rows } = build('Nombre,Apellidos,Correo\nAna,López,ana@e.com');
    expect(mapping.missing).toEqual([]);
    expect(rows[0].consent).toBeNull();
    expect(rows[0].submitted_at).toBe('');
  });

  it('un aviso negativo se envía como falso para que el servidor rechace la fila; uno afirmativo, como verdadero', () => {
    const csv = 'Nombre,Correo,Aviso de privacidad\nAna,a@e.com,Sí\nBeto,b@e.com,No\nCarla,c@e.com,';
    expect(build(csv).rows.map((r) => r.consent)).toEqual([true, false, null]);
  });

  it('un archivo antiguo con «Nombre completo» sigue funcionando sin columna de apellidos', () => {
    const { mapping, rows } = build('Nombre completo,Correo\nAna López Pérez,ana@e.com');
    expect(mapping.missing).toEqual([]);
    expect(rows[0].full_name).toBe('Ana López Pérez');
  });

  it('avisa si faltan las columnas obligatorias', () => {
    const { mapping } = build('Apellidos,Escuela\nLópez,Prepa');
    expect(mapping.missing.map((c) => c.key)).toEqual(['first_name', 'email']);
  });

  it('la plantilla descargable usa las columnas del Forms y se importa sin errores', () => {
    const { mapping, rows } = build(PARTICIPANT_TEMPLATE);
    expect(mapping.missing).toEqual([]);
    expect(mapping.unknownHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({ full_name: 'Ana López Pérez', high_school_grade: '3', entry_period: '2027-08', consent: true });
    expect(PARTICIPANT_TEMPLATE.toLowerCase()).not.toContain('nacimiento');
  });
});
