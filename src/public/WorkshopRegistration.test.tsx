import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_TYPES, LIMITS } from '../../supabase/functions/workshop-intake/validation.ts';
import WorkshopRegistration from './WorkshopRegistration';

vi.mock('../theme/ThemeProvider', async () => {
  const { neutralTheme } = await import('../theme/neutralTheme');
  return { useTheme: () => ({ theme: neutralTheme }) };
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
async function fillTaller(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/Escuela o división que organiza/), D1);
  await user.click(screen.getByRole('radio', { name: /Académica/ }));
  setVal(/Nombre del taller/, 'Código Rojo Cancún 2035');
  setVal(/Presenta tu taller/, 'Resuelve una crisis digital en equipo durante una hora.');
}
async function fillExperiencia(user: ReturnType<typeof userEvent.setup>) {
  setVal(/Por qué debería elegirlo/, 'Porque vivirás cómo se trabaja bajo presión con tecnología real.');
  setVal(/objetivo del taller/, 'Que el alumno identifique el rol de las TI en una emergencia.');
  setVal(/Qué hará el alumno durante/, 'Simulación guiada con retos por equipos y retroalimentación.');
  setVal(/Qué se llevará el alumno/, 'Una idea clara de qué hace un ingeniero en ciberseguridad.');
  const kw = screen.getByRole('textbox', { name: /Palabras clave/ });
  for (const k of ['ciberseguridad', 'inteligencia artificial', 'simulación']) await user.type(kw, `${k}{Enter}`);
}
async function fillOperacion(user: ReturnType<typeof userEvent.setup>) {
  setVal(/Duración de cada sesión/, '45');
  setVal(/Cupo por sesión/, '30');
  setVal(/Desde/, '10:00');
  setVal(/Hasta/, '14:00');
  setVal(/Descanso entre sesiones/, '10');
  setVal(/^Edificio/, 'Edificio A');
  await user.click(screen.getByRole('checkbox', { name: /Aún no tengo el espacio/ }));
}
async function fillCarreras(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'Ingeniería en TI e IA' }));
  await user.click(screen.getByRole('checkbox', { name: 'Administración de Empresas' }));
}

/** Completa todos los pasos y llega a la revisión. */
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

describe('catálogo', () => {
  it('catálogo válido: muestra el asistente en el paso 1 y consume solo la Edge Function', async () => {
    await open();
    expect(screen.getByText('Paso 1 de 6: Tus datos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://example.supabase.co/functions/v1/workshop-intake');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('catálogo vacío: «Registro aún no disponible», sin formulario ni datos de respaldo', async () => {
    handlers.GET = () => json({ ...catalog, divisions: [], careers: [] });
    render(<WorkshopRegistration />);
    expect(await screen.findByRole('heading', { name: 'Registro aún no disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Siguiente/ })).not.toBeInTheDocument();
  });

  it('sin carreras reales aunque haya divisiones: también no disponible', async () => {
    handlers.GET = () => json({ ...catalog, careers: [] });
    render(<WorkshopRegistration />);
    expect(await screen.findByRole('heading', { name: 'Registro aún no disponible' })).toBeInTheDocument();
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
    setVal(/Por qué debería elegirlo/, 'Porque vivirás cómo se trabaja bajo presión con tecnología real.');
    setVal(/objetivo del taller/, 'Que el alumno identifique el rol de las TI en una emergencia.');
    setVal(/Qué hará el alumno durante/, 'Simulación guiada con retos por equipos y retroalimentación.');
    setVal(/Qué se llevará el alumno/, 'Una idea clara de qué hace un ingeniero en ciberseguridad.');
    await user.type(screen.getByRole('textbox', { name: /Palabras clave/ }), 'ia{Enter}');
    await next(user);
    expect(heading('La experiencia del alumno')).toBeInTheDocument();
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
    expect(screen.getByText('Escuela de Ingeniería')).toBeInTheDocument();
    expect(screen.getByText('Por confirmar')).toBeInTheDocument();
    expect(screen.getByText('Ingeniería en TI e IA')).toBeInTheDocument();
    expect(screen.getByText('Administración de Empresas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar propuesta' })).toBeInTheDocument();

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
    expect(body.session_duration_minutes).toBe(45);
    for (const forbidden of ['status', 'edition_id', 'reviewed_by', 'reviewed_at', 'published_activity_id', 'admin_notes', 'is_demo']) {
      expect(body).not.toHaveProperty(forbidden);
    }
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
    expect(await screen.findByText(/catálogo de escuelas y carreras se actualizó/)).toBeInTheDocument();
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
