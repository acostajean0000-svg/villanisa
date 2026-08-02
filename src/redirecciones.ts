/**
 * Redirecciones desde el WordPress anterior.
 *
 * Cuando villanisa.com.do apunte al sitio nuevo, cada URL vieja que Google
 * tenga indexada o que alguien tenga enlazada debe llegar a algún sitio útil.
 * Sin esto, todo eso se convierte en errores 404 y se pierde lo poco de
 * autoridad que el dominio haya acumulado en 25 años.
 *
 * Las ~80 páginas demo del tema WPEstate se mandan al inicio: no aportan
 * nada, pero un 301 es mejor que un 404 para las que tengan algún enlace.
 */

export const redirecciones: Record<string, string> = {
  /* --- Páginas reales del sitio anterior -------------------------------
   *
   * OJO: aquí NO va ninguna ruta que exista como página del sitio nuevo.
   * Astro resuelve las redirecciones antes que las páginas, así que declarar
   * '/contacto' o '/nosotros' aquí hacía que esas dos páginas no se generaran
   * y devolvieran 404 — justamente las dos a las que apunta el menú.
   * El sufijo con barra lo resuelve el propio servidor; no hay que declararlo.
   */
  '/about-us': '/nosotros/',
  '/agencias': '/nosotros/',
  '/meet-the-team': '/agentes/',
  '/contact-us': '/contacto/',
  '/contact-form': '/contacto/',
  '/nuestros-agentes': '/agentes/',
  '/featured-agents': '/agentes/',
  '/agents-shortcode': '/agentes/',
  '/lista-de-propiedades': '/propiedades/',
  '/properties': '/propiedades/',
  '/propiedades-por-tipos': '/propiedades/',
  '/advanced-search': '/propiedades/',
  '/half-map-radius-search': '/propiedades/',
  '/homepage-with-map': '/propiedades/',
  '/blog-villanisa': '/',
  '/terms-and-coditions': '/',
  '/services': '/nosotros/',
  '/testimonials': '/nosotros/',
  '/faq': '/contacto/',
  '/book-now': '/contacto/',

  /* --- Taxonomías del tema anterior ------------------------------------ */
  '/listings/apartamentos': '/propiedades/?tipo=apartamentos',
  '/listings/casas': '/propiedades/?tipo=casas',
  '/listings/villas': '/propiedades/?tipo=villas',
  '/listings/condominios': '/propiedades/',
  '/city/santo-domingo': '/propiedades/?ciudad=santo-domingo-d-n',
  '/city/santo-domingo-distrito-nacional': '/propiedades/?ciudad=santo-domingo-d-n',
  '/city/punta-cana': '/propiedades/?ciudad=punta-cana',
  '/city/bavaro-punta-cana': '/propiedades/?ciudad=punta-cana',
  '/city/bonao': '/propiedades/',
  '/area/la-esperilla': '/propiedades/',
  '/area/bavaro': '/apartamentos-en-venta/bavaro/',

  /* --- Panel de cliente y CRM del tema: nunca debieron ser públicos ----- */
  '/dashboard-main': '/',
  '/dashboard-profile-page': '/',
  '/dashboard-invoices': '/',
  '/dashboard-analytics': '/',
  '/dashboard-inbox': '/',
  '/dashboard-add-property': '/',
  '/dashboard-property-list': '/',
  '/dashboard-favorite-properties': '/',
  '/dashboard-saved-searches': '/',
  '/dashboard-search-results': '/',
  '/dashboard-add-agent': '/',
  '/dashboard-agent-list': '/',
  '/wpestate-crm': '/',
  '/wpestate-crm-contacts': '/',
  '/wpestate-crm-contacts-2': '/',
  '/wpestate-crm-leads-inquires': '/',
  '/wpestate-crm-leads-inquires-2': '/',
  '/wpestate-crm-2': '/',
  '/property-submit-front': '/contacto/',
  '/register-and-login-forms': '/',
  '/save-favorites': '/propiedades/',
  '/compare-listings': '/propiedades/',
  '/saved-searches': '/propiedades/',
  '/directory': '/propiedades/',

  /* --- Restos de la plantilla: comercio, portafolio, pagos ------------- */
  '/shop': '/',
  '/shop-2': '/',
  '/portfolio': '/',
  '/stripe': '/',
  '/paypal-processor': '/',
  '/zillow-estimate': '/',
  '/menu': '/',
  '/splash-page': '/',
  '/pagina-ejemplo': '/',
  '/developers': '/',
  '/search-results-for-agents-agencies-developers': '/agentes/',
  '/featured-developer-agency': '/agentes/',
  '/featured-property': '/propiedades/',
  '/featured-article': '/',
  '/recent-items': '/propiedades/',
  '/grid-builder': '/',
  '/taxonomy-grid-and-carousels': '/propiedades/',
  '/properties-carousel': '/propiedades/',
  '/properties-list-2': '/propiedades/',
  '/properties-list-just-featured': '/propiedades/',
  '/properties-list-sidebar-left': '/propiedades/',
  '/properties-list-with-ajax-filters': '/propiedades/',
  '/listings-by-user': '/propiedades/',
  '/single-map-with-pins': '/propiedades/',
  '/lead-generation-form': '/contacto/',
  '/inquiry-form': '/contacto/',
  '/membership-packages-shortcode-2': '/',
  '/testimonials-2': '/nosotros/',
  '/agent-list-sidebar-left': '/agentes/',
  '/agents-list-sidebar-right-2': '/agentes/',
  '/blog-list': '/',
  '/blog-list-no-sidebar-2': '/',
  '/blog-list-sidebar-right': '/',
  '/home-page-2016': '/',
  '/homepage-v2': '/',
  '/homepage-elementor': '/',
  '/elementor-homepage-2': '/',
  '/elementor-homepage-v3': '/',
  '/elementor-home-v4': '/',
  '/elementor-home-v5': '/',
  '/elementor-home-v6': '/',
};

/* Las plantillas demo numeradas se generan en vez de escribirse a mano */
for (let i = 1; i <= 8; i++) {
  redirecciones[`/demo-property-template-${i}`] = '/propiedades/';
  redirecciones[`/demo-property-template-${i}-elementor`] = '/propiedades/';
}
