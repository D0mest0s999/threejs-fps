// Nightshift Depot — the hand-in program for the threejs-fps-02 entry (Node 22, standard
// library only). The game itself is the game/ folder beside this file: plain static files
// the browser loads as ES modules, three.js vendored under game/vendor and named by an
// import map, no build step and nothing fetched. This program copies game/ and
// screenshots/ into the output directory and writes dossier.json there — the summary the
// judge reads — using the kit's vendored builder with the scorer's own caps, so an entry
// the scorer would refuse (too many screenshots, an oversized file, too much game) is
// refused here first instead.
//
// Run it the way the grader does, from the repository root:
//   node main.ts            (writes to /output)
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps, mirrored from the kit's gate configuration: only text_max_bytes
// shapes the dossier's bytes; the rest are tripwires that stop a doomed hand-in early.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

const shotsDir = join(outputDir, 'screenshots');
mkdirSync(shotsDir, { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), shotsDir, { recursive: true });
}

const dossier = buildDossier(outputDir, GATE);
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`nightshift depot: game and screenshots copied to ${outputDir}, dossier ${dossier.length} bytes`);
