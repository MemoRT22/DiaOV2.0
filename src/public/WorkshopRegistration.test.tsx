import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_TYPES, EXPERIENCE_CATEGORIES, LIMITS } from '../../supabase/functions/workshop-intake/validation.ts';
import WorkshopRegistration from './WorkshopRegistration';

vi.mock('../theme/PublicThemeProvider', async () => {
  const { neutralTheme } = await import('../theme/neutralTheme');
  return { usePublicTheme: () => ({ theme: neutralTheme }) };
});

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const C2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const C3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const C4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

const catalog = {
  edition: { name: 'Día OV 2026', event_date: '2026-10-15' },
  divisions: [
    { division_id: D1, division_name: 'Escuela de Ingeniería' },
    { division_id: D2, division_name: 'Escuela de Negocios' },
  ],
  careers: [
    { career_id: C1, career_name: 'Ingeniería en TI e IA', division_id: D1 },
    { career_id: C2, career_name: 'Ingeniería en Ciberseguridad', division_id: D1 },
    { career_id: C3, career_name: 'Administración de Empresas', division_id: D2 },
    { career_id: C4, career_name: 'Mercadotecnia', division_id: D2 },
  ],
  activity_types: ACTIVITY_TYPES,
  experience_categories: EXPERIENCE_CATEGORIES,
  limits: LIMITS,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const receipt = { submission_id: 'abcdef12-0000-4000-8000-000000000000', status: 'submitted', submitted_at: '2026-10-05T12:00:00Z' };

type Handler = (init?: RequestInit) => Promise<Response> | Response;
let handlers: { GET: Handler; POST: Handler };
const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => (init?.method === 'POST' ? handlers.POST(init) : handlers.GET(init)));
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const gets = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET');

beforeEach(() => {
  handlers = { GET: () => json(catalog), POST: () => json(receipt, 201) };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

const setVal = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /^(Siguiente|Revisar propuesta|Guardar y volver a la revisión)$/ }));
const heading = (name: RegExp | string) => screen.getByRole('heading', { level: 2, name });

async function open() {
  const user = userEvent.setup();
  render(<WorkshopRegistration />);
  await screen.findByRole('heading', { level: 2, name: 'Tus datos' });
  return user;
}

function fillResponsable() {
  setVal(/Nombre completo/, 'Ana Pérez');
  setVal(/Correo electrónico/, 'ana@example.com');
}
async function fillTaller(user: ReturnType<typeof userEvent.setup>, type: RegExp = /Taller académico/) {
  await user.click(screen.getByRole('radio', { name: type }));
  setVal(/Nombre del taller/, 'Código Rojo Cancún 2035');
  setVal(/Presenta tu taller/, 'Resuelve una crisis digital en equipo durante una hora.');
}
async function fillVidaTaller(user: ReturnType<typeof userEvent.setup>, category: RegExp = /Deportiva/) {
  await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
  await user.click(screen.getByRole('radio', { name: category }));
  setVal(/Nombre de la actividad/, 'Torneo de fútbol relámpago');
  setVal(/Descripción corta/, 'Un torneo rápido para convivir y divertirse con tu escuela.');
}
async function fillVidaExperiencia(user: ReturnType<typeof userEvent.setup>, objetivo?: string) {
  if (objetivo) setVal(/Qué buscas generar/, objetivo);
  setVal(/Con qué queremos que se queden/, 'Amistades nuevas y ganas de volver a participar.');
  const kw = screen.getByRole('textbox', { name: /Palabras clave/ });
  for (const k of ['deporte', 'convivencia', 'fútbol']) await user.type(kw, `${k}{Enter}`);
}
async function fillExperiencia(user: ReturnType<typeof userEvent.setup>) {
  setVal(/objetivo del taller/, 'Que el alumno identifique el rol de las TI en una emergencia.');
  setVal(/Qué aprendizaje o idea/, 'Una idea clara de qué hace un ingeniero en ciberseguridad.');
  const kw = screen.getByRole('textbox', { name: /Palabras clave/ });
  for (const k of ['ciberseguridad', 'inteligencia artificial', 'simulación']) await user.type(kw, `${k}{Enter}`);
}
async function fillOperacion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: '1 hora' }));
  setVal(/Cupo por sesión/, '30');
  setVal(/^Edificio/, 'Edificio A');
  await user.click(screen.getByRole('checkbox', { name: /Aún no tengo el espacio/ }));
}
async function fillCarreras(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'Ingeniería en TI e IA' }));
  await user.click(screen.getByRole('checkbox', { name: 'Administración de Empresas' }));
}

/** Completa todos los pasos (académico) y llega a la revisión. */
async function toReview(user: ReturnType<typeof userEvent.setup>) {
  fillResponsable();
  await next(user);
  await fillTaller(user);
  await next(user);
  await fillExperiencia(user);
  await next(user);
  await fillOperacion(user);
  await next(user);
  await fillCarreras(user);
  await next(user);
  await screen.findByRole('heading', { level: 2, name: 'Revisa y envía' });
}

/** Vida Universitaria: no hay paso de carreras; de Logística se pasa directo a la revisión. */
async function toReviewVida(user: ReturnType<typeof userEvent.setup>, objetivo?: string) {
  fillResponsable();
  await next(user);
  await fillVidaTaller(user);
  await next(user);
  await fillVidaExperiencia(user, objetivo);
  await next(user);
  await fillOperacion(user);
  await next(user);
  await screen.findByRole('heading', { level: 2, name: 'Revisa y envía' });
}

describe('catálogo', () => {
  it('catálogo válido: muestra el asistente en el paso 1 y consume solo la Edge Function', async () => {
    await open();
    expect(screen.getByText('Paso 1 de 6: Tus datos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    // solo nombre y correo del responsable
    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo electrónico/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Teléfono|WhatsApp/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://example.supabase.co/functions/v1/workshop-intake');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('catálogo académico vacío: la página abre el formulario (Vida Universitaria no necesita catálogo)', async () => {
    handlers.GET = () => json({ ...catalog, divisions: [], careers: [] });
    await open();
    expect(screen.getByText('Paso 1 de 6: Tus datos')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Registro aún no disponible' })).not.toBeInTheDocument();
  });

  it('catálogo vacío: Vida Universitaria se completa y se envía normalmente', async () => {
    handlers.GET = () => json({ ...catalog, divisions: [], careers: [] });
    const user = await open();
    await toReviewVida(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    expect(await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' })).toBeInTheDocument();
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string).career_ids).toEqual([]);
  });

  it('catálogo vacío: Académico informa que falta el catálogo en su momento y no avanza', async () => {
    handlers.GET = () => json({ ...catalog, divisions: [], careers: [] });
    const user = await open();
    fillResponsable();
    await next(user);
    expect(screen.queryByText(/talleres académicos aún no está disponible/)).not.toBeInTheDocument();
    await fillTaller(user);
    expect(screen.getByText(/registro de talleres académicos aún no está disponible/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(heading('Tu taller')).toBeInTheDocument();
    // cambiar a Vida Universitaria quita el aviso y habilita el flujo
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    expect(screen.queryByText(/talleres académicos aún no está disponible/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('sin edición activa (503): no disponible', async () => {
    handlers.GET = () => json({ error: 'NO_ACTIVE_EDITION' }, 503);
    render(<WorkshopRegistration />);
    expect(await screen.findByRole('heading', { name: 'Registro aún no disponible' })).toBeInTheDocument();
  });

  it('error de red: mensaje y reintento', async () => {
    let calls = 0;
    handlers.GET = () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return json(catalog);
    };
    const user = userEvent.setup();
    render(<WorkshopRegistration />);
    expect(await screen.findByText(/No pudimos cargar el formulario/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tus datos' })).toBeInTheDocument();
  });
});

describe('pasos y validaciones', () => {
  it('paso vacío: no avanza, muestra errores asociados a los campos y lleva el foco al primero', async () => {
    const user = await open();
    await next(user);
    expect(heading('Tus datos')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa estos puntos');
    const name = screen.getByLabelText(/Nombre completo/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name.getAttribute('aria-describedby')).toContain('wf-facilitator_name-error');
    expect(document.getElementById('wf-facilitator_name-error')).toHaveTextContent('Este dato es obligatorio.');
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('correo inválido se explica en lenguaje natural; cualquier dominio es válido', async () => {
    const user = await open();
    setVal(/Nombre completo/, 'Ana Pérez');
    setVal(/Correo electrónico/, 'sin-arroba');
    await next(user);
    expect(document.getElementById('wf-facilitator_email-error')).toHaveTextContent(/correo válido/);
    setVal(/Correo electrónico/, 'persona@gmail.com');
    await next(user);
    expect(await screen.findByRole('heading', { level: 2, name: 'Tu taller' })).toBeInTheDocument();
  });

  it('navega entre pasos y conserva lo escrito al volver (Atrás)', async () => {
    const user = await open();
    fillResponsable();
    await next(user);
    expect(screen.getByText('Paso 2 de 6: Tu taller')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('Ana Pérez');
    expect(screen.getByText('Paso 1 de 6: Tus datos')).toBeInTheDocument();
  });

  it('el foco pasa al título al cambiar de paso', async () => {
    const user = await open();
    fillResponsable();
    await next(user);
    await waitFor(() => expect(heading('Tu taller')).toHaveFocus());
  });

  it('el espacio puede quedar «Por confirmar»', async () => {
    const user = await open();
    fillResponsable();
    await next(user);
    await fillTaller(user);
    await next(user);
    await fillExperiencia(user);
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: /Aún no tengo el espacio/ }));
    expect(screen.getByLabelText(/Salón o espacio/)).toHaveValue('Por confirmar');
    expect(screen.getByLabelText(/Salón o espacio/)).toBeDisabled();
  });
});

describe('tipo de taller y logística simplificada', () => {
  async function toTaller() {
    const user = await open();
    fillResponsable();
    await next(user);
    return user;
  }

  it('solo hay dos tipos y no se pregunta la escuela o división', async () => {
    await toTaller();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Taller académico/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Vida Universitaria/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Liderazgo$/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Escuela o división/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('la duración es un selector de dos opciones (30 minutos / 1 hora), sin horario ni descanso', async () => {
    const user = await toTaller();
    await fillTaller(user);
    await next(user);
    await fillExperiencia(user);
    await next(user);
    expect(heading('Logística')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: /Duración del taller/ });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['30', '60']);
    expect(within(group).queryByRole('radio', { name: '15 minutos' })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '30 minutos' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '1 hora' })).toBeInTheDocument();
    expect(screen.getByText(/entre las 10:00 a\. m\. y las 12:00 p\. m\./)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Desde|Hasta|Descanso/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Duración de cada sesión/)).not.toBeInTheDocument();
    // sin duración no avanza
    await user.click(screen.getByRole('checkbox', { name: /Aún no tengo el espacio/ }));
    setVal(/Cupo por sesión/, '30');
    setVal(/^Edificio/, 'Edificio A');
    await next(user);
    expect(heading('Logística')).toBeInTheDocument();
    expect(document.getElementById('wf-session_duration_minutes-error')).toHaveTextContent(/obligatorio|Elige/);
  });
});

describe('Vida Universitaria: copy y campos propios', () => {
  async function toVidaTaller() {
    const user = await open();
    fillResponsable();
    await next(user);
    return user;
  }

  it('académico no muestra la clasificación; Vida Universitaria sí, con las 5 categorías', async () => {
    const user = await toVidaTaller();
    await user.click(screen.getByRole('radio', { name: /Taller académico/ }));
    expect(screen.queryByRole('group', { name: /Clasificación de la experiencia/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre del taller/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    const group = screen.getByRole('group', { name: /Clasificación de la experiencia/ });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra',
    ]);
    expect(within(group).getByRole('radio', { name: 'Artística / cultural' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la actividad/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Descripción corta/)).toBeInTheDocument();
    expect(screen.getByText('En pocas palabras, ¿qué experiencia vivirán los alumnos?')).toBeInTheDocument();
  });

  it('la categoría es obligatoria', async () => {
    const user = await toVidaTaller();
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    setVal(/Nombre de la actividad/, 'Torneo de fútbol relámpago');
    setVal(/Descripción corta/, 'Un torneo rápido para convivir y divertirse con tu escuela.');
    await next(user);
    expect(heading('Tu actividad')).toBeInTheDocument();
    expect(document.getElementById('wf-experience_category-error')).toBeInTheDocument();
  });

  it('preguntas de experiencia con lenguaje propio; el objetivo es opcional y no hay CareerPicker', async () => {
    const user = await toVidaTaller();
    await fillVidaTaller(user);
    await next(user);
    expect(heading('Experiencia')).toBeInTheDocument();
    expect(screen.getByLabelText(/Qué buscas generar/).id).toBe('wf-objective');
    expect(screen.getByText(/Qué buscas generar/).textContent).toMatch(/opcional/);
    // se avanza sin objetivo
    await fillVidaExperiencia(user);
    await next(user);
    expect(heading('Logística')).toBeInTheDocument();
    await fillOperacion(user);
    await next(user);
    expect(heading('Revisa y envía')).toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar carrera')).not.toBeInTheDocument();
  });

  it('review: copy de Vida Universitaria, categoría, sin carreras; el objetivo solo si se respondió', async () => {
    const user = await open();
    await toReviewVida(user);
    expect(screen.getByText('Vida Universitaria')).toBeInTheDocument();
    expect(screen.getByText('Deportiva')).toBeInTheDocument();
    expect(screen.getByText('Torneo de fútbol relámpago')).toBeInTheDocument();
    expect(screen.getByText('Descripción corta')).toBeInTheDocument();
    expect(screen.getByText('¿Con qué queremos que se queden después de participar?')).toBeInTheDocument();
    expect(screen.queryByText('¿Qué buscas generar con esta experiencia?')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Carreras relacionadas' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Escuela o división|Nombre del taller|Presentación$/)).not.toBeInTheDocument();
  });

  it('review: el objetivo se muestra si fue respondido y viaja en el payload', async () => {
    const user = await open();
    await toReviewVida(user, 'Integración y convivencia');
    expect(screen.getByText('¿Qué buscas generar con esta experiencia?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ activity_type: 'vida_universitaria', experience_category: 'deportiva', objective: 'Integración y convivencia', career_ids: [] });
  });

  it('sin objetivo: se envía null y nunca un texto por defecto', async () => {
    const user = await open();
    await toReviewVida(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string).objective).toBeNull();
  });
});

describe('cambio de tipo durante el llenado', () => {
  it('Vida Universitaria permite 15 y al cambiar a académico normaliza a 30 antes de enviar', async () => {
    const user = await open();
    await toReviewVida(user, 'Integración y convivencia');
    await user.click(screen.getByRole('button', { name: 'Editar Logística' }));
    const duration = screen.getByRole('group', { name: /Duración del taller/ });
    expect(within(duration).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['15', '30', '60']);
    await user.click(within(duration).getByRole('radio', { name: '15 minutos' }));
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Editar Tu actividad' }));
    await user.click(screen.getByRole('radio', { name: /Taller académico/ }));
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Editar Logística' }));
    const academicDuration = screen.getByRole('group', { name: /Duración del taller/ });
    expect(within(academicDuration).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['30', '60']);
    expect(within(academicDuration).getByRole('radio', { name: '30 minutos' })).toBeChecked();
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await fillCarreras(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toMatchObject({ activity_type: 'academica', session_duration_minutes: 30 });
  });
  it('Vida Universitaria → académico: limpia la categoría, conserva lo escrito y nunca la envía', async () => {
    const user = await open();
    fillResponsable();
    await next(user);
    await fillVidaTaller(user, /^Liderazgo$/);
    await user.click(screen.getByRole('radio', { name: /Taller académico/ }));
    expect(screen.queryByRole('group', { name: /Clasificación de la experiencia/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre del taller/)).toHaveValue('Torneo de fútbol relámpago');
    await next(user);
    await fillExperiencia(user);
    await next(user);
    await fillOperacion(user);
    await next(user);
    await fillCarreras(user);
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body.activity_type).toBe('academica');
    expect(body.experience_category).toBeNull();
    expect(body.career_ids).toEqual([C1, C3]);
  });

  it('académico → Vida Universitaria desde la revisión: sin carreras y con la categoría elegida', async () => {
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Editar Tu taller' }));
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    await user.click(screen.getByRole('radio', { name: /Otra/ }));
    await next(user);
    await screen.findByRole('heading', { level: 2, name: 'Revisa y envía' });
    expect(screen.getByText('Otra')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Carreras relacionadas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body.activity_type).toBe('vida_universitaria');
    expect(body.experience_category).toBe('otra');
    expect(body.career_ids).toEqual([]);
  });

  it('Vida Universitaria → académico → Vida Universitaria: las carreras marcadas antes nunca viajan', async () => {
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Editar Tu taller' }));
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    await user.click(screen.getByRole('radio', { name: /^Liderazgo$/ }));
    await user.click(screen.getByRole('radio', { name: /Taller académico/ }));
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    expect(screen.getByRole('radio', { name: /^Liderazgo$/ })).not.toBeChecked(); // la categoría se limpió al pasar por académico
    await user.click(screen.getByRole('radio', { name: /Deportiva/ }));
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body.experience_category).toBe('deportiva');
    expect(body.career_ids).toEqual([]);
  });
});

describe('palabras clave', () => {
  async function toKeywords() {
    const user = await open();
    fillResponsable();
    await next(user);
    await fillTaller(user);
    await next(user);
    return user;
  }

  it('agrega con Enter o coma, no repite (sin acentos/mayúsculas), limita a 5 y permite quitar', async () => {
    const user = await toKeywords();
    const kw = screen.getByRole('textbox', { name: /Palabras clave/ });
    await user.type(kw, 'Simulación{Enter}');
    await user.type(kw, 'simulacion{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(/ya está en la lista/);
    expect(within(screen.getByRole('list', { name: 'Palabras clave agregadas' })).getAllByRole('listitem')).toHaveLength(1);
    expect(kw).toHaveValue('simulacion'); // se conserva lo escrito para que pueda corregirlo
    await user.clear(kw);
    await user.type(kw, 'uno,dos,tres,cuatro');
    await user.type(kw, '{Enter}');
    expect(screen.getByText('5 de 5 palabras clave')).toBeInTheDocument();
    expect(kw).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Quitar palabra clave: uno' }));
    expect(screen.getByText('4 de 5 palabras clave')).toBeInTheDocument();
    expect(kw).toBeEnabled();
  });

  it('menos de 3 palabras clave bloquea el avance con un mensaje claro', async () => {
    const user = await toKeywords();
    setVal(/objetivo del taller/, 'Que el alumno identifique el rol de las TI en una emergencia.');
    setVal(/Qué aprendizaje o idea/, 'Una idea clara de qué hace un ingeniero en ciberseguridad.');
    await user.type(screen.getByRole('textbox', { name: /Palabras clave/ }), 'ia{Enter}');
    await next(user);
    expect(heading('Experiencia del alumno')).toBeInTheDocument();
    expect(document.getElementById('wf-keywords-error')).toHaveTextContent(/al menos 3 palabras clave/);
  });
});

describe('carreras relacionadas', () => {
  async function toCarreras() {
    const user = await open();
    fillResponsable();
    await next(user);
    await fillTaller(user);
    await next(user);
    await fillExperiencia(user);
    await next(user);
    await fillOperacion(user);
    await next(user);
    await screen.findByRole('heading', { level: 2, name: 'Carreras relacionadas' });
    return user;
  }

  it('selección múltiple sin tope, con contador, agrupación por escuela y quitar', async () => {
    const user = await toCarreras();
    expect(screen.getByText('Aún no has elegido carreras.')).toBeInTheDocument();
    expect(screen.getByText('Escuela de Ingeniería')).toBeInTheDocument();
    expect(screen.getByText('Escuela de Negocios')).toBeInTheDocument();
    for (const n of ['Ingeniería en TI e IA', 'Ingeniería en Ciberseguridad', 'Administración de Empresas', 'Mercadotecnia']) {
      await user.click(screen.getByRole('checkbox', { name: n }));
    }
    expect(screen.getByText('4 carreras seleccionadas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar carrera: Mercadotecnia' }));
    expect(screen.getByText('3 carreras seleccionadas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar todas' }));
    expect(screen.getByText('Aún no has elegido carreras.')).toBeInTheDocument();
  });

  it('la búsqueda filtra sin importar acentos ni mayúsculas', async () => {
    const user = await toCarreras();
    await user.type(screen.getByLabelText('Buscar carrera'), 'ADMINISTRACION');
    expect(screen.getByRole('checkbox', { name: 'Administración de Empresas' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Mercadotecnia' })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Buscar carrera'));
    await user.type(screen.getByLabelText('Buscar carrera'), 'zzz');
    expect(screen.getByText('No encontramos carreras con ese nombre.')).toBeInTheDocument();
  });

  it('Vida Universitaria no muestra el paso de carreras; vuelve si cambia a académico', async () => {
    const user = await open();
    fillResponsable();
    await next(user);
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    expect(screen.getByText('Paso 2 de 5: Tu actividad')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Taller académico/ }));
    expect(screen.getByText('Paso 2 de 6: Tu taller')).toBeInTheDocument();
  });

  it('sin carreras no deja continuar', async () => {
    const user = await toCarreras();
    await next(user);
    expect(heading('Carreras relacionadas')).toBeInTheDocument();
    expect(document.getElementById('wf-career_ids-error')).toHaveTextContent(/al menos una carrera/);
  });
});

describe('revisión y envío', () => {
  it('muestra el resumen completo y permite volver a editar una sección', async () => {
    const user = await open();
    await toReview(user);
    expect(screen.getByText('Código Rojo Cancún 2035')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Taller académico')).toBeInTheDocument();
    expect(screen.getByText('1 hora')).toBeInTheDocument();
    expect(screen.getByText('Por confirmar')).toBeInTheDocument();
    expect(screen.getByText('Ingeniería en TI e IA')).toBeInTheDocument();
    expect(screen.getByText('Administración de Empresas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar propuesta' })).toBeInTheDocument();
    // la revisión muestra únicamente datos vigentes
    for (const gone of [/Teléfono/, /Escuela o división/, /Horario disponible/, /Descanso entre sesiones/, /Desde|Hasta/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Carreras relacionadas' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar Tus datos' }));
    expect(heading('Tus datos')).toBeInTheDocument();
    setVal(/Nombre completo/, 'Ana María Pérez');
    await next(user);
    expect(await screen.findByRole('heading', { level: 2, name: 'Revisa y envía' })).toBeInTheDocument();
    expect(screen.getByText('Ana María Pérez')).toBeInTheDocument();
  });

  it('envía una sola petición con la propuesta (sin campos administrativos) y muestra la confirmación', async () => {
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    expect(await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' })).toBeInTheDocument();
    expect(screen.getByText(/será revisada por el equipo organizador/)).toBeInTheDocument();
    expect(screen.getByText(/nos pondremos en contacto/)).toBeInTheDocument();
    expect(screen.getByText(/Todavía no significa que el taller esté publicado/)).toBeInTheDocument();
    expect(screen.getByText('ABCDEF12')).toBeInTheDocument();

    expect(posts()).toHaveLength(1);
    const init = posts()[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.career_ids).toEqual([C1, C3]);
    expect(body.keywords).toEqual(['ciberseguridad', 'inteligencia artificial', 'simulación']);
    expect(body.room_space).toBe('Por confirmar');
    expect(body.session_duration_minutes).toBe(60);
    expect(body.activity_type).toBe('academica');
    for (const forbidden of ['status', 'edition_id', 'reviewed_by', 'reviewed_at', 'published_activity_id', 'admin_notes', 'is_demo',
      'facilitator_phone', 'division_id', 'operating_start_time', 'operating_end_time', 'break_minutes']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('académico multidisciplinario: envía carreras de divisiones distintas', async () => {
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    const divisionOf = (id: string) => catalog.careers.find((c) => c.career_id === id)?.division_id;
    expect(new Set(body.career_ids.map(divisionOf)).size).toBe(2);
  });

  it('Vida Universitaria: salta carreras, la revisión no las muestra y se envía con career_ids vacío', async () => {
    const user = await open();
    await toReviewVida(user);
    expect(screen.getByText('Paso 5 de 5: Revisa y envía')).toBeInTheDocument();
    expect(screen.getByText('Vida Universitaria')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Carreras relacionadas' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingeniería en TI e IA|Administración de Empresas/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    expect(await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body.activity_type).toBe('vida_universitaria');
    expect(body.career_ids).toEqual([]);
    for (const retired of ['facilitator_phone', 'division_id', 'operating_start_time', 'operating_end_time', 'break_minutes']) {
      expect(body).not.toHaveProperty(retired);
    }
  });

  it('si el alumno marcó carreras y luego cambia a Vida Universitaria, no se envían', async () => {
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Editar Tu taller' }));
    await user.click(screen.getByRole('radio', { name: /Vida Universitaria/ }));
    await user.click(screen.getByRole('radio', { name: /Deportiva/ }));
    await next(user); // Guardar y volver a la revisión
    await screen.findByRole('heading', { level: 2, name: 'Revisa y envía' });
    expect(screen.queryByRole('region', { name: 'Carreras relacionadas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' });
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string).career_ids).toEqual([]);
  });

  it('bloquea el doble envío mientras la petición está pendiente', async () => {
    let resolve!: (r: Response) => void;
    handlers.POST = () => new Promise<Response>((r) => (resolve = r));
    const user = await open();
    await toReview(user);
    const form = screen.getByRole('form', { name: 'Revisa y envía' });
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    fireEvent.submit(form);
    fireEvent.submit(form);
    const busy = await screen.findByRole('button', { name: 'Enviando…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(posts()).toHaveLength(1);
    resolve(json(receipt, 201));
    expect(await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });
});

describe('errores HTTP del envío (mensajes humanos, sin detalles internos)', () => {
  async function submitWith(res: () => Response) {
    handlers.POST = res;
    const user = await open();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    return user;
  }

  it('VALIDATION_FAILED: pide revisar los campos marcados y lleva al paso del campo', async () => {
    await submitWith(() => json({ error: 'VALIDATION_FAILED', errors: [{ field: 'title', code: 'TOO_SHORT' }] }, 422));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tu taller' })).toBeInTheDocument();
    expect(screen.getByText(/Revisa los campos marcados/)).toBeInTheDocument();
    expect(document.getElementById('wf-title-error')).toHaveTextContent(/mínimo 5/);
  });

  it('NO_ACTIVE_EDITION: registro no disponible', async () => {
    await submitWith(() => json({ error: 'NO_ACTIVE_EDITION' }, 503));
    expect(await screen.findByRole('heading', { name: 'Registro aún no disponible' })).toBeInTheDocument();
  });

  it.each(['INVALID_CAREER', 'CATALOG_MISMATCH'])('%s: catálogo actualizado, ofrece recargar las opciones', async (code) => {
    const user = await submitWith(() => json({ error: code }, 422));
    expect(await screen.findByText(/catálogo de carreras se actualizó/)).toBeInTheDocument();
    const before = gets().length;
    await user.click(screen.getByRole('button', { name: 'Actualizar opciones' }));
    await waitFor(() => expect(gets().length).toBe(before + 1));
    expect(screen.getByRole('heading', { level: 2, name: 'Revisa y envía' })).toBeInTheDocument();
  });

  it('PAYLOAD_TOO_LARGE (413): contenido demasiado extenso', async () => {
    await submitWith(() => json({ error: 'PAYLOAD_TOO_LARGE' }, 413));
    expect(await screen.findByText(/contenido es demasiado extenso/)).toBeInTheDocument();
  });

  it('500: error general sin mostrar detalles internos', async () => {
    await submitWith(() => json({ error: 'INTERNAL_ERROR', detail: 'relation "workshop_submissions" violates constraint SELECT * FROM x' }, 500));
    expect(await screen.findByText(/problema de nuestro lado/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/workshop_submissions|constraint|SELECT/);
    expect(screen.getByRole('button', { name: 'Enviar propuesta' })).toBeEnabled();
  });

  it('error de red: mensaje de conexión y se puede reintentar', async () => {
    const user = await submitWith(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await screen.findByText(/No pudimos conectarnos/)).toBeInTheDocument();
    handlers.POST = () => json(receipt, 201);
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }));
    expect(await screen.findByRole('heading', { name: '¡Recibimos tu propuesta!' })).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
  });
});
