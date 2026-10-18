import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { LOCAL_PLAYABLE_CANDIDATE_MOUNT } from "./src/local-playable-urls.ts";
import { resolveSafeCandidateFile } from "./src/safe-candidate-path.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const candidateRoot = path.join(repoRoot, ".territory/sprint-3/playable-v3/candidate");
const candidateMount = LOCAL_PLAYABLE_CANDIDATE_MOUNT;

function territoryCandidateStaticPlugin(): Plugin {
  return {
    name: "territory-candidate-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(`${candidateMount}/`)) {
          next();
          return;
        }
        const relative = url.slice(candidateMount.length + 1);
        const absolute = resolveSafeCandidateFile(candidateRoot, relative);
        if (!absolute || !existsSync(absolute) || statSync(absolute).isDirectory()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        if (absolute.endsWith(".mvt")) {
          res.setHeader("content-type", "application/vnd.mapbox-vector-tile");
        } else if (absolute.endsWith(".json")) {
          res.setHeader("content-type", "application/json");
        } else if (absolute.endsWith(".geojson")) {
          res.setHeader("content-type", "application/geo+json");
        }
        createReadStream(absolute).pipe(res);
      });
    }
  };
}

export default defineConfig({
  base: process.env.VITE_TERRITORY_BASE_PATH ?? process.env.BASE_PATH ?? "/",
  plugins: [territoryCandidateStaticPlugin()],
  optimizeDeps: {
    exclude: ["maplibre-gl"]
  },
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [repoRoot]
    }
  }
});
