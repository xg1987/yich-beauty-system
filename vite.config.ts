import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.PACKAGE_VERSION": JSON.stringify(pkg.version),
  },
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType !== "html") return deps;
        return deps.filter((dep) => dep.startsWith("assets/vendor-"));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "vendor-react";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          if (id.endsWith("/src/app/authenticatedAppHelpers.ts")) return "authenticated-helpers";
          if (id.endsWith("/src/domain/cashierFlow.ts")) return "cashier-flow";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxyTarget,
    },
  },
});
