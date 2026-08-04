/**
 * Autenticación básica del panel y de la API de contenido.
 *
 * Estaba implementada dos veces, con criterios distintos: el panel comparaba
 * en tiempo constante y el endpoint de escritura con `===`. Y las dos hacían
 * `atob(cred).split(':')` desestructurando en `[usuario, clave]`, lo que rompe
 * de dos formas:
 *
 *   PANEL_CLAVE = "Aa1:Bb2:Cc3"     → llega solo "Aa1"        → 401 eterno
 *   PANEL_CLAVE = "contraseñaSegura" → llega "contraseÃ±a..."  → 401 eterno
 *
 * Es decir: cualquier clave generada por un gestor de contraseñas —que suelen
 * incluir símbolos— dejaba el panel inaccesible sin ningún mensaje que lo
 * explicara. La clave hay que partirla por el PRIMER ':' y decodificar el
 * base64 como UTF-8, no como Latin-1.
 */

export const env = (clave: string): string | undefined => {
  const enEjecucion =
    typeof process !== 'undefined' && process.env ? process.env[clave] : undefined;
  // El `?? {}` no es adorno: si un día esto corre en un entorno donde Vite no
  // sustituye `import.meta.env` —una prueba en Node puro, otro empaquetador—
  // sin él la lectura de una variable inexistente no devuelve undefined: lanza
  // TypeError. Y como de aquí cuelgan la puerta del panel y el circuito de
  // leads, un TypeError aquí es el sitio entero devolviendo 500.
  const enBuild = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return enEjecucion ?? enBuild[clave];
};

/** Comparación en tiempo constante: no filtra cuántos caracteres acertó. */
function igualSeguro(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // La longitud sí se filtra; es información que no ayuda a un atacante.
  if (ba.length !== bb.length) return false;
  let dif = 0;
  for (let i = 0; i < ba.length; i++) dif |= ba[i] ^ bb[i];
  return dif === 0;
}

export type Veredicto =
  | { ok: true }
  | { ok: false; motivo: 'sin-clave' | 'no-autorizado' };

export function verificarBasic(cabecera: string | null): Veredicto {
  const usuarioEsperado = env('PANEL_USUARIO') || 'villanisa';
  const claveEsperada = env('PANEL_CLAVE');

  // Sin clave configurada se cierra, nunca se abre.
  if (!claveEsperada) return { ok: false, motivo: 'sin-clave' };
  if (!cabecera?.startsWith('Basic ')) return { ok: false, motivo: 'no-autorizado' };

  let texto: string;
  try {
    texto = new TextDecoder().decode(
      Uint8Array.from(atob(cabecera.slice(6).trim()), (c) => c.charCodeAt(0))
    );
  } catch {
    return { ok: false, motivo: 'no-autorizado' };
  }

  const corte = texto.indexOf(':');
  if (corte < 0) return { ok: false, motivo: 'no-autorizado' };

  const usuario = texto.slice(0, corte);
  const clave = texto.slice(corte + 1);

  // Las dos comparaciones siempre se ejecutan: sin cortocircuito.
  const okUsuario = igualSeguro(usuario, usuarioEsperado);
  const okClave = igualSeguro(clave, claveEsperada);
  return okUsuario && okClave ? { ok: true } : { ok: false, motivo: 'no-autorizado' };
}

export const RETO = {
  'WWW-Authenticate': 'Basic realm="Panel Villanisa", charset="UTF-8"',
  'Cache-Control': 'no-store',
};
