import sanitizeHtml from 'sanitize-html';

/**
 * Limpieza del HTML que llega del CRM.
 *
 * Las descripciones y biografías se escriben en el editor de AlterEstate y se
 * insertan tal cual en la página. Eso significa dos cosas:
 *
 * 1. Cualquiera con acceso al CRM —o cualquiera que comprometa la cuenta de un
 *    asesor— puede meter un <script> en una descripción y ese script correría
 *    en villanisa.com.do, sobre los visitantes. Hoy no hay ninguno; el
 *    problema es que nada lo impide.
 *
 * 2. Un <h1> escrito en el editor produce un segundo H1 en la ficha. Ya pasa
 *    en una propiedad: la ficha tiene dos, y el segundo está vacío.
 *
 * Se permite el subconjunto que un asesor necesita para redactar, se degradan
 * los encabezados a h3 (por debajo del H1 y de los H2 de la plantilla) y se
 * descarta el resto en vez de escaparlo, para que un pegado desde Word no
 * llene la ficha de basura visible.
 */
const ETIQUETAS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h3', 'blockquote'];

export function limpiarHTML(sucio: string | null | undefined): string {
  if (!sucio) return '';
  return sanitizeHtml(sucio, {
    allowedTags: ETIQUETAS,
    // rel y target tienen que estar permitidos o el transformTags de abajo
    // los añade y el filtro los vuelve a quitar acto seguido.
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Un encabezado del editor no puede competir con el H1 de la página.
    transformTags: {
      h1: 'h3',
      h2: 'h3',
      h4: 'h3',
      h5: 'h3',
      h6: 'h3',
      // Enlaces externos escritos por un asesor: sin pasar autoridad ni
      // dejar la pestaña de origen accesible.
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' }),
    },
    // Nada de <style>, <script>, <iframe>: se descartan con su contenido.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
  }).trim();
}
