import { defineConfig } from "@playwright/test";

// Needs a Convex dev deployment (npx convex dev) and the Next dev server; the web server below starts Next.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 390, height: 844 } },
  webServer: { command: "npm run dev:frontend", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
