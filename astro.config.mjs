// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

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
  vite: { plugins: [tailwindcss()] },
  image: {
    domains: ['secure.alterestate.com', 'alterestate.s3.amazonaws.com'],
    remotePatterns: [{ protocol: 'https' }],
  },
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  build: { inlineStylesheets: 'auto' },
});
