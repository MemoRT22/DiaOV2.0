// Acceso inicial. Mide POR SEPARADO tres componentes: (1) el sitio institucional (HubSpot) que incrusta la aplicación, (2) el HTML de
// la aplicación en Netlify y (3) sus recursos estáticos (JS/CSS/fuentes/imágenes). Son proveedores distintos: sus resultados nunca se
// mezclan. SOLO lectura. Contra Netlify/HubSpot/dominio institucional exige LOADTEST_THIRD_PARTY_AUTHORIZATION (autorización escrita
// de sus responsables y proveedores); sin ella se limita a 5 usuarios virtuales. Úsalo contra un despliegue de PRUEBAS (deploy preview
// o sitio de staging), nunca contra el sitio oficial el día del evento.
import http from 'k6/http';
import { check, group } from 'k6';
import { statics } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { assertSafe, ENV } from '../lib/env.js';
import { staticBytes, staticCacheHit, staticOk, staticTotal, staticTtfb } from '../lib/metrics.js';
import { summarize } from '../lib/summary.js';
import { chance, think } from '../lib/think.js';

export const options = {
  scenarios: { static_access: statics({ exec: 'visit' }) },
  thresholds: thresholds.merge(thresholds.statics(), { infra_errors: ['rate<0.01'] }),
};

export function setup() {
  assertSafe({ static: true });
  if (!ENV.netlifyUrl && !ENV.institutionalUrl) throw new Error('[loadtest] Define NETLIFY_URL y/o INSTITUTIONAL_URL (despliegue de PRUEBAS).');
}

const ASSET = /(?:src|href)="((?:\/assets\/|\.\/assets\/)[^"]+\.(?:js|css|woff2?|png|jpe?g|svg|webp))"/g;
const isHit = (response) => {
  const h = response.headers;
  const status = `${h['Cache-Status'] || h['cache-status'] || ''} ${h['X-Cache'] || h['x-cache'] || ''} ${h['Cf-Cache-Status'] || ''}`.toLowerCase();
  return /\bhit\b/.test(status) || Number(h.Age || h.age || 0) > 0;
};

function record(response, component) {
  const ok = response.status >= 200 && response.status < 400;
  const tags = { component };
  staticTtfb.add(response.timings.waiting, tags);
  staticTotal.add(response.timings.duration, tags);
  staticBytes.add(response.body ? response.body.length : 0, tags);
  staticOk.add(ok, tags);
  if (ok) staticCacheHit.add(isHit(response), tags);
  return ok;
}

let assets = null; // lista de recursos, descubierta una vez por VU

export function visit() {
  if (ENV.institutionalUrl) {
    group('institucional (HubSpot)', () => {
      const page = http.get(ENV.institutionalUrl, { tags: { component: 'institutional', kind: 'static' } });
      record(page, 'institutional');
      check(page, { 'sitio institucional 200': (r) => r.status === 200 });
      if (ENV.netlifyUrl) {
        // El acceso real es un iframe: la página institucional debe apuntar a la aplicación.
        const host = ENV.netlifyUrl.replace(/^https?:\/\//, '');
        check(page, { 'la página institucional incrusta la aplicación (iframe)': (r) => typeof r.body === 'string' && r.body.includes(host) });
      }
    });
    think(1, 3);
  }
  if (ENV.netlifyUrl) {
    group('aplicación (Netlify) · HTML', () => {
      const html = http.get(`${ENV.netlifyUrl}/`, { tags: { component: 'netlify_html', kind: 'static' } });
      record(html, 'netlify_html');
      check(html, { 'HTML de la aplicación 200': (r) => r.status === 200 });
      if (!assets && typeof html.body === 'string') {
        assets = [];
        for (const match of html.body.matchAll(ASSET)) assets.push(match[1].replace(/^\.\//, '/'));
      }
      // Ruta profunda: Netlify debe responder la misma aplicación (redirección SPA a index.html con 200).
      const deep = http.get(`${ENV.netlifyUrl}/pasaporte`, { tags: { component: 'netlify_html', kind: 'static' } });
      record(deep, 'netlify_html');
      check(deep, { 'ruta profunda (SPA) 200': (r) => r.status === 200 });
    });
    // Una persona con el navegador ya cargado (caché caliente) no vuelve a pedir los recursos con hash.
    if (!chance(Number(__ENV.STATIC_WARM_RATIO || 0.25))) {
      group('aplicación (Netlify) · recursos estáticos', () => {
        const requests = (assets || []).map((path) => ['GET', `${ENV.netlifyUrl}${path}`, null, { tags: { component: 'netlify_assets', kind: 'static' } }]);
        for (let i = 0; i < requests.length; i += 6) { // un navegador abre ~6 conexiones por origen
          for (const response of http.batch(requests.slice(i, i + 6))) record(response, 'netlify_assets');
        }
      });
    }
  }
  think(3, 15);
}

export const handleSummary = summarize('01-static');
