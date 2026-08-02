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
    imageService: true,
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
  image: {
    domains: ['secure.alterestate.com', 'alterestate.s3.amazonaws.com'],
    remotePatterns: [{ protocol: 'https' }],
  },
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  build: { inlineStylesheets: 'auto' },
});
