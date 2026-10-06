-- Catálogo académico oficial. Los códigos son estables y los UUID se resuelven por código.
-- El seed es repetible y nunca convierte ni modifica fixtures demo.
DO $seed$
DECLARE
  v_divisions integer;
  v_careers integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM divisions
    WHERE is_demo AND code IN (
      'DIV-SALUD', 'DIV-CREATIVAS', 'DIV-NEGOCIOS',
      'DIV-SOCIALES-JURIDICAS', 'DIV-LIDERAZGO', 'DIV-TURISMO-HOTELERIA-GASTRONOMIA'
    )
  ) OR EXISTS (
    SELECT 1 FROM careers
    WHERE is_demo AND code LIKE 'CAR-REAL-%'
  ) THEN
    RAISE EXCEPTION 'CATALOG_SEED_DEMO_CODE_COLLISION';
  END IF;

  INSERT INTO divisions (code, name, sort_order, is_demo)
  VALUES
    ('DIV-SALUD', 'Ciencias de la Salud', 10, false),
    ('DIV-CREATIVAS', 'Áreas Creativas', 20, false),
    ('DIV-NEGOCIOS', 'Negocios', 30, false),
    ('DIV-SOCIALES-JURIDICAS', 'Ciencias Sociales y Jurídicas', 40, false),
    ('DIV-LIDERAZGO', 'Liderazgo', 50, false),
    ('DIV-TURISMO-HOTELERIA-GASTRONOMIA', 'Turismo, Hotelería y Gastronomía', 60, false)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order
  WHERE divisions.is_demo = false;
  GET DIAGNOSTICS v_divisions = ROW_COUNT;
  IF v_divisions <> 6 THEN
    RAISE EXCEPTION 'CATALOG_SEED_DIVISION_COLLISION';
  END IF;

  INSERT INTO careers (code, name, division_id, is_active, is_demo)
  SELECT s.code, s.name, d.id, true, false
  FROM (VALUES
    ('DIV-SALUD', 'CAR-REAL-MEDICO-CIRUJANO', 'Médico Cirujano'),
    ('DIV-SALUD', 'CAR-REAL-MEDICINE-SURGERY', 'Medicine & Surgery'),
    ('DIV-SALUD', 'CAR-REAL-MEDICO-CIRUJANO-DENTISTA', 'Médico Cirujano Dentista'),
    ('DIV-SALUD', 'CAR-REAL-BIOTECNOLOGIA', 'Biotecnología'),
    ('DIV-SALUD', 'CAR-REAL-PSICOLOGIA', 'Psicología'),
    ('DIV-SALUD', 'CAR-REAL-TERAPIA-FISICA-REHABILITACION', 'Terapia Física y Rehabilitación'),
    ('DIV-SALUD', 'CAR-REAL-NUTRICION', 'Nutrición'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-INDUSTRIAL-DIRECCION', 'Ingeniería Industrial para la Dirección'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-CIVIL', 'Ingeniería Civil'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-TI-NEGOCIOS-DIGITALES', 'Ingeniería en Tecnologías de la Información y Negocios Digitales'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-TI-INTELIGENCIA-ARTIFICIAL', 'Ingeniería en Tecnologías de la Información e Inteligencia Artificial'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-TI-CIBERSEGURIDAD', 'Ingeniería en Tecnologías de la Información y Ciberseguridad'),
    ('DIV-CREATIVAS', 'CAR-REAL-DISENO-INDUSTRIAL', 'Diseño Industrial'),
    ('DIV-CREATIVAS', 'CAR-REAL-DISENO-MODA-INNOVACION', 'Diseño de Moda e Innovación'),
    ('DIV-CREATIVAS', 'CAR-REAL-ARQUITECTURA', 'Arquitectura'),
    ('DIV-CREATIVAS', 'CAR-REAL-COMUNICACION', 'Comunicación'),
    ('DIV-CREATIVAS', 'CAR-REAL-DIRECCION-ENTRETENIMIENTO', 'Dirección de Empresas de Entretenimiento'),
    ('DIV-CREATIVAS', 'CAR-REAL-DIRECCION-ANIMACION-VFX', 'Dirección en Animación y Efectos Visuales'),
    ('DIV-CREATIVAS', 'CAR-REAL-ING-AUDIO', 'Ingeniería en Audio'),
    ('DIV-NEGOCIOS', 'CAR-REAL-ADMINISTRACION-DIRECCION-EMPRESAS', 'Administración y Dirección de Empresas'),
    ('DIV-NEGOCIOS', 'CAR-REAL-FINANZAS-CONTADURIA', 'Finanzas y Contaduría Pública'),
    ('DIV-NEGOCIOS', 'CAR-REAL-MERCADOTECNIA-ESTRATEGICA', 'Mercadotecnia Estratégica'),
    ('DIV-NEGOCIOS', 'CAR-REAL-DIRECCION-FINANCIERA', 'Dirección Financiera'),
    ('DIV-NEGOCIOS', 'CAR-REAL-NEGOCIOS-INTERNACIONALES', 'Negocios Internacionales'),
    ('DIV-NEGOCIOS', 'CAR-REAL-STRATEGIC-BUSINESS-MANAGEMENT', 'Strategic Business Management'),
    ('DIV-NEGOCIOS', 'CAR-REAL-INTERNATIONAL-BUSINESS', 'International Business'),
    ('DIV-NEGOCIOS', 'CAR-REAL-DIRECCION-DEPORTE', 'Dirección del Deporte'),
    ('DIV-NEGOCIOS', 'CAR-REAL-ENTRENAMIENTO-INNOVACION-DEPORTIVA', 'Entrenamiento e Innovación Deportiva'),
    ('DIV-SOCIALES-JURIDICAS', 'CAR-REAL-DERECHO', 'Derecho'),
    ('DIV-SOCIALES-JURIDICAS', 'CAR-REAL-RELACIONES-INTERNACIONALES', 'Relaciones Internacionales'),
    ('DIV-LIDERAZGO', 'CAR-REAL-LIDERAZGO-GESTION-ESTRATEGICA-INTERNACIONAL', 'Liderazgo y Gestión Estratégica Internacional'),
    ('DIV-TURISMO-HOTELERIA-GASTRONOMIA', 'CAR-REAL-TURISMO-INTERNACIONAL', 'Turismo Internacional'),
    ('DIV-TURISMO-HOTELERIA-GASTRONOMIA', 'CAR-REAL-DIRECCION-INTERNACIONAL-HOTELES', 'Dirección Internacional de Hoteles'),
    ('DIV-TURISMO-HOTELERIA-GASTRONOMIA', 'CAR-REAL-GASTRONOMIA', 'Gastronomía'),
    ('DIV-TURISMO-HOTELERIA-GASTRONOMIA', 'CAR-REAL-GASTRONOMY', 'Gastronomy')
  ) AS s(division_code, code, name)
  JOIN divisions d ON d.code = s.division_code AND d.is_demo = false
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    division_id = EXCLUDED.division_id,
    is_active = true
  WHERE careers.is_demo = false;
  GET DIAGNOSTICS v_careers = ROW_COUNT;

  IF v_careers <> 35 THEN
    RAISE EXCEPTION 'CATALOG_SEED_COUNT_MISMATCH';
  END IF;
END
$seed$;
