import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const MAP_DIR = 'src/world/goodsprings';
const ALLOWED_FILES = new Set(['worldMap.json', 'prospectorSaloon.json']);

/**
 * Lets the map editor save back to the repository during `npm run dev`.
 *
 * Mirrors rogueout's planSaver: a dev-server-only route (`apply: 'serve'`), so it does not exist
 * in a production build — the published game can never write a file. `?file=` is restricted to a
 * fixed whitelist so the route can't be used to write anywhere else in the repo.
 */
function mapSaver(): Plugin {
  return {
    name: 'map-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__map', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const file = url.searchParams.get('file') ?? '';

        if (!ALLOWED_FILES.has(file)) {
          res.statusCode = 400;
          res.end(`Unknown map file "${file}". Allowed: ${[...ALLOWED_FILES].join(', ')}`);
          return;
        }

        const fullPath = resolve(process.cwd(), MAP_DIR, file);

        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(fullPath, 'utf8'));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Only GET and POST.');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          // Validate before writing so a malformed save can't corrupt the file on disk.
          try {
            JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end('Body is not valid JSON; file left unchanged.');
            return;
          }
          writeFileSync(fullPath, body, 'utf8');
          res.end(`Saved ${body.length} bytes to ${MAP_DIR}/${file}`);
        });
      });
    },
  };
}

// Relative base so the built site works both from a plain local static server and from a GitHub
// Pages project subpath (https://user.github.io/repo/) without needing to hardcode the repo name.
export default defineConfig({
  base: './',
  plugins: [mapSaver()],
  build: {
    rollupOptions: {
      // The editor is a second page rather than a mode of the game: it shares the tile table and
      // map data, and nothing else, so keeping it separate stops it reaching into the game.
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
