import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts (which still drives `npm run dev`/`build`)
 * since the dev/build config's `/api`, `/uploads`, `/socket.io` dev-proxy
 * entries are meaningless for tests - there's no dev server involved, and
 * every network call a test exercises goes through a mocked module instead
 * (see `src/test/setup.ts` and each test file's `vi.mock(...)` calls).
 * Tests are co-located next to the source they cover (`Component.test.tsx`
 * beside `Component.tsx`), unlike the server's separate `tests/` directory
 * - the right convention differs by layer: the server's integration-style
 * tests share one throwaway database per file, which reads more naturally
 * grouped in its own folder; these are isolated component tests, which
 * benefit more from sitting next to the component they cover.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    css: false,
  },
});
