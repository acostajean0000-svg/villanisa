// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { redirecciones } from './src/redirecciones.ts';

export default defineConfig({
  site: 'https://villanisa.com.do',
  output: 'static',
  adapter: vercel({
    // Desactivado a propósito. Activarlo publica /_vercel/image, y con el
    // remotePatterns de abajo aceptaba CUALQUIER origen https: se comprobó
    // que villanisa.com.do servía imágenes de terceros, facturadas a esta
    // cuenta. El sitio no usa <Image> de Astro: todas las fotos pasan por
    // aeImage() contra el CDN de AlterEstate.
    imageService: false,
    webAnalytics: { enabled: true },
  }),
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/panel'),
      changefreq: 'daily',
      lastmod: new Date(),
    }),
  ],
  // 301 desde las URLs del WordPress anterior: sin esto, apuntar el
  // dominio convertiría en 404 todo lo que Google tiene indexado.
  redirects: redirecciones,

  vite: { plugins: [tailwindcss()] },
  // Sin `image`: no se optimiza ninguna imagen en el servidor de Vercel,
  // así que no hay lista de dominios que mantener ni proxy que exponer.
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  build: { inlineStylesheets: 'auto' },
});
