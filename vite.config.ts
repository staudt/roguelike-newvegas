import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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

const CHUNK_DIR = 'src/world/goodsprings/chunks';
const META_FILE = 'src/world/goodsprings/world.json';
const CHUNK_NAME = /^(-?\d{1,5})_(-?\d{1,5})\.json$/;
const CHUNK_QUERY = /^(-?\d{1,5}),(-?\d{1,5})$/;

/**
 * Dev-only route for the chunked world: `?meta=1` is world.json, `?list=1` the chunk coordinates
 * on disk, `?chunk=cx,cy` one chunk file (GET/POST/DELETE). Chunk names are rebuilt from two
 * parsed integers, never taken from the query, so nothing can escape the chunks directory.
 */
function worldSaver(): Plugin {
  return {
    name: 'world-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__world', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const chunkDir = resolve(process.cwd(), CHUNK_DIR);
        const metaPath = resolve(process.cwd(), META_FILE);
        const fail = (code: number, message: string): void => {
          res.statusCode = code;
          res.end(message);
        };

        if (url.searchParams.get('list') === '1' && req.method === 'GET') {
          const coords = existsSync(chunkDir)
            ? readdirSync(chunkDir)
                .map((f) => CHUNK_NAME.exec(f))
                .filter((m): m is RegExpExecArray => m !== null)
                .map((m) => ({ cx: Number(m[1]), cy: Number(m[2]) }))
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(coords));
          return;
        }

        let target: string;
        let expectCoords: { cx: number; cy: number } | null = null;
        if (url.searchParams.get('meta') === '1') {
          target = metaPath;
        } else {
          const m = CHUNK_QUERY.exec(url.searchParams.get('chunk') ?? '');
          if (!m) return fail(400, 'Expected ?meta=1, ?list=1 or ?chunk=cx,cy (integers).');
          const cx = Number(m[1]);
          const cy = Number(m[2]);
          target = resolve(chunkDir, `${cx}_${cy}.json`);
          if (!target.startsWith(chunkDir + sep)) return fail(400, 'Bad chunk path.');
          expectCoords = { cx, cy };
        }

        if (req.method === 'GET') {
          if (!existsSync(target)) return fail(404, 'No such file.');
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(target, 'utf8'));
          return;
        }
        if (req.method === 'DELETE') {
          if (!expectCoords) return fail(405, 'Only chunks can be deleted.');
          if (existsSync(target)) unlinkSync(target);
          res.end('Deleted.');
          return;
        }
        if (req.method !== 'POST') return fail(405, 'Only GET, POST and DELETE.');

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return fail(400, 'Body is not valid JSON; file left unchanged.');
          }
          if (expectCoords) {
            const p = parsed as { cx?: unknown; cy?: unknown };
            if (p.cx !== expectCoords.cx || p.cy !== expectCoords.cy) {
              return fail(400, 'Chunk body cx/cy do not match the query; file left unchanged.');
            }
            mkdirSync(chunkDir, { recursive: true });
          }
          writeFileSync(target, body, 'utf8');
          res.end(`Saved ${body.length} bytes.`);
        });
      });
    },
  };
}

// Relative base so the built site works both from a plain local static server and from a GitHub
// Pages project subpath (https://user.github.io/repo/) without needing to hardcode the repo name.
export default defineConfig({
  base: './',
  plugins: [mapSaver(), worldSaver()],
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
