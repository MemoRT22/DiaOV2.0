// Configuración y GUARDAS DE SEGURIDAD de la suite. Todo lo que puede causar daño se decide aquí, antes de que se haga una sola petición:
// por omisión la ejecución es de SOLO LECTURA y solo contra hosts explícitamente permitidos. Se evalúa al cargar el módulo (en el
// contexto de inicialización de k6), así que una configuración insegura aborta la prueba sin enviar tráfico.

const list = (value) => (value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
const hostOf = (url) => {
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url || '');
  return match ? match[1].toLowerCase() : '';
};
const matches = (host, pattern) => host === pattern || host.endsWith(`.${pattern}`) || host.includes(pattern);

/** Frase exacta que habilita las ESCRITURAS (reservar, cancelar, check-in, enviar encuestas). Cualquier otro valor = solo lectura. */
export const WRITES_PHRASE = 'yes-this-is-an-isolated-test-environment';

/** Proyectos de Supabase de producción: se rechazan SIEMPRE, sin importar ninguna otra variable. Ampliable con PRODUCTION_SUPABASE_REFS. */
const PRODUCTION_REFS = ['spoeehpziokmknecwcbd', ...list(__ENV.PRODUCTION_SUPABASE_REFS)];

/** Sitios institucionales y plataformas de terceros: exigen una autorización escrita (referencia) y un tope de carga. */
const THIRD_PARTY = ['anahuac.mx', 'anahuac.edu.mx', 'hubspot', 'hs-sites', 'hsforms', 'hubspotusercontent', 'netlify', ...list(__ENV.THIRD_PARTY_HOSTS)];

export const ENV = {
  targetEnv: (__ENV.TARGET_ENV || '').toLowerCase(),
  supabaseUrl: (__ENV.SUPABASE_URL || '').replace(/\/+$/, ''),
  anonKey: __ENV.SUPABASE_ANON_KEY || '',
  allowedHosts: list(__ENV.LOADTEST_ALLOW_HOSTS || 'localhost,127.0.0.1'),
  writes: __ENV.LOADTEST_ALLOW_WRITES === WRITES_PHRASE,
  profile: (__ENV.PROFILE || 'smoke').toLowerCase(),
  scale: Math.max(0.01, Math.min(1, Number(__ENV.SCALE || 1))),
  maxVus: Number(__ENV.MAX_VUS || 2000),
  netlifyUrl: (__ENV.NETLIFY_URL || '').replace(/\/+$/, ''),
  institutionalUrl: __ENV.INSTITUTIONAL_URL || '',
  thirdPartyAuthorization: (__ENV.LOADTEST_THIRD_PARTY_AUTHORIZATION || '').trim(),
  staticMaxVusUnauthorized: 5,
  dataDir: __ENV.DATA_DIR || '../data',
  thinkScale: Number(__ENV.THINK_SCALE || 1),
};

const fail = (message) => { throw new Error(`[loadtest-safety] ${message}`); };

/**
 * Valida la configuración. `needs`: { supabase, writes, static }. Lanza (y por tanto aborta k6) ante cualquier riesgo.
 * Nunca imprime ni exige claves privilegiadas: solo la clave pública `anon`.
 */
export function assertSafe(needs = {}) {
  if (!['local', 'staging', 'loadtest'].includes(ENV.targetEnv)) {
    fail('TARGET_ENV debe ser local, staging o loadtest (un entorno AISLADO de pruebas). Nunca producción.');
  }
  if (needs.supabase) {
    const host = hostOf(ENV.supabaseUrl);
    if (!ENV.supabaseUrl || !host) fail('Falta SUPABASE_URL del entorno de pruebas.');
    if (!ENV.anonKey) fail('Falta SUPABASE_ANON_KEY (la clave pública anon del entorno de pruebas; jamás una service_role).');
    if (/service_role/i.test(ENV.anonKey) || decodeRole(ENV.anonKey) === 'service_role') fail('SUPABASE_ANON_KEY parece una clave privilegiada (service_role). Se rechaza.');
    for (const ref of PRODUCTION_REFS) if (ref && host.includes(ref)) fail(`SUPABASE_URL apunta a un proyecto de PRODUCCIÓN (${ref}). Se rechaza sin excepción.`);
    if (!ENV.allowedHosts.some((allowed) => matches(host, allowed))) {
      fail(`El host ${host} no está en LOADTEST_ALLOW_HOSTS (${ENV.allowedHosts.join(', ')}). Agrégalo solo si es el entorno aislado de pruebas.`);
    }
    if (THIRD_PARTY.some((pattern) => matches(host, pattern))) fail(`El host ${host} es un sitio institucional o de terceros; no es un backend de pruebas.`);
  }
  if (needs.static) {
    for (const [name, url] of [['NETLIFY_URL', ENV.netlifyUrl], ['INSTITUTIONAL_URL', ENV.institutionalUrl]]) {
      if (!url) continue;
      const host = hostOf(url);
      if (!ENV.allowedHosts.some((allowed) => matches(host, allowed))) fail(`${name}: el host ${host} no está en LOADTEST_ALLOW_HOSTS.`);
      if (THIRD_PARTY.some((pattern) => matches(host, pattern)) && !ENV.thirdPartyAuthorization) {
        fail(`${name} (${host}) es un sitio institucional o una plataforma de terceros (Netlify/HubSpot). Sin LOADTEST_THIRD_PARTY_AUTHORIZATION (referencia de la autorización escrita de sus responsables y proveedores) la carga se limita a ${ENV.staticMaxVusUnauthorized} usuarios virtuales.`);
      }
    }
  }
  if (needs.writes && !ENV.writes) {
    // No es un error: la suite degrada a solo lectura. Se avisa una vez.
    return { readOnly: true };
  }
  return { readOnly: !ENV.writes };
}

/** Tope de usuarios virtuales para el escenario estático cuando no hay autorización escrita de terceros. */
export function staticVuCap(requested) {
  const url = [ENV.netlifyUrl, ENV.institutionalUrl].filter(Boolean).map(hostOf);
  const thirdParty = url.some((host) => THIRD_PARTY.some((pattern) => matches(host, pattern)));
  return thirdParty && !ENV.thirdPartyAuthorization ? Math.min(requested, ENV.staticMaxVusUnauthorized) : requested;
}

function decodeRole(jwt) {
  try {
    const part = jwt.split('.')[1];
    const json = String.fromCharCode(...base64ToBytes(part));
    return JSON.parse(json).role || '';
  } catch (_) {
    return '';
  }
}
function base64ToBytes(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const out = [];
  let buffer = 0; let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | chars.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return out;
}

export const isWriteEnabled = () => ENV.writes;
export { hostOf };
