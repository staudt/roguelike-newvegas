import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const MAP_DIR = 'src/world/goodsprings';
const SAFE_FILE = /^[A-Za-z0-9-]+\.json$/;

/**
 * Lets the map editor save back to the repository during `npm run dev`.
 *
 * Mirrors rogueout's planSaver: a dev-server-only route (`apply: 'serve'`), so it does not exist
 * in a production build — the published game can never write a file. `?file=` is restricted to a
 * plain-filename pattern that must resolve inside the map directory, so the route can't be used to
 * write anywhere else in the repo. Any such file may be created (the editor's New building helper
 * does), and GET ?list=1 lists the map files present.
 */
function mapSaver(): Plugin {
  return {
    name: 'map-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__map', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const mapDir = resolve(process.cwd(), MAP_DIR);

        if (url.searchParams.get('list') === '1' && req.method === 'GET') {
          const files = readdirSync(mapDir).filter((f) => SAFE_FILE.test(f)).sort();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
          return;
        }

        const file = url.searchParams.get('file') ?? '';
        const fullPath = resolve(mapDir, file);

        if (!SAFE_FILE.test(file) || !fullPath.startsWith(mapDir + sep)) {
          res.statusCode = 400;
          res.end(`Bad map file name "${file}". Expected letters, digits and dashes plus .json.`);
          return;
        }

        if (req.method === 'GET') {
          if (!existsSync(fullPath)) {
            res.statusCode = 404;
            res.end(`No such map file "${file}"`);
            return;
          }
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
