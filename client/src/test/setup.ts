import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// React Testing Library's automatic post-test cleanup only self-registers
// when it detects a global `afterEach` (as with Jest's globals, or
// Vitest's own `globals: true`) - this project deliberately doesn't set
// `globals: true` (tests import `describe`/`it`/`expect` explicitly,
// matching the server test suite's convention), so that auto-registration
// never fires and DOM from one test leaks into the next unless this runs
// explicitly for every test file.
afterEach(cleanup);

// jsdom has no ResizeObserver at all - recharts' <ResponsiveContainer>
// (used by AdminRevenue.tsx's trend chart) requires one to mount without
// throwing. A no-op stub is enough since jsdom never actually resizes
// anything for tests to react to.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
