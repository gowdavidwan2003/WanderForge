import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * `.mjs` rather than `.js` on purpose. The package is not `"type": "module"`, so
 * a plain `.js` config would be parsed as CommonJS, fail on this file's `import`
 * statements, and — for the library files under test — make Node re-parse them as
 * ESM after the fact, which is what produced the MODULE_TYPELESS_PACKAGE_JSON
 * warning. Making the extension explicit avoids that without switching the whole
 * Next app over to ESM semantics.
 *
 * The alias mirrors `jsconfig.json`, which Next honours but Vitest knows nothing
 * about: before this, any test importing `@/lib/...` failed to resolve, so tests
 * had to use relative paths while the code they tested used `@/`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node, not jsdom: everything under test today is pure logic. Component
    // tests would need jsdom plus @testing-library, which is not yet warranted.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx,mjs}'],
    // Keep the suite honest about what it actually covers.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.js'],
      exclude: ['src/lib/**/*.test.js'],
    },
  },
});
