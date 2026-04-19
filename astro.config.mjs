import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://calfj1ng.github.io',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
