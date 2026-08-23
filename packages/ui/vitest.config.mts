import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// F2-B.1 only needed to test cn() (a pure function), so this used environment: "node". F2-B.2
// adds the first React components (Button, Input), so this now needs jsdom + the React plugin
// — same as apps/web's vitest config. Kept package-local rather than shared, and without a
// setupFiles entry (each component test file registers Testing Library's cleanup itself),
// so as not to introduce a new config file beyond this one.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
