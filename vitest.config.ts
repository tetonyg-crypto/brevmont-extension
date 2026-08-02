import { defineConfig } from 'vitest/config';

// Pure unit tests (inventory scanner, etc.). Playwright owns tests/*.spec.ts;
// vitest owns tests/unit/*.test.ts. happy-dom gives DOMParser/querySelector for
// the .vehicle-card extraction path without a full browser.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
