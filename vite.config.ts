import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
// Tests run in India Standard Time (UTC+5:30): date bugs only show up when local time is ahead of UTC.
export default defineConfig({ plugins: [react(), tailwind()], test: { env: { TZ: "Asia/Kolkata" } } });
