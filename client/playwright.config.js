import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../artifacts/browser-report" }],
  ],
  outputDir: "../artifacts/browser-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: existsSync(
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      )
        ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
        : undefined,
    },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    env: { VITE_API_URL: "http://127.0.0.1:4000/api" },
  },
});

