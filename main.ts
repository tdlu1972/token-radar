// Launch Radar: token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with dashboard/model.js (the same file the page runs, so the
// board and the screens cannot disagree), and writes to /output:
//   board.json    the ranked pre-token board, every watchlist slug plus the early rows below the floor
//   data.js       the snapshot's protocols for the page, which recomputes every figure from them
//   dashboard/    the static page, screenshots/ its captures, dossier.json what the judge reads
//
// Outside the grader: MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const Model = createRequire(import.meta.url)('./dashboard/model.js');

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback;
}

function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const radar = Model.build(snapshot);

// The gate's own rules, checked here so a bad board never leaves the container.
const known = new Set(snapshot.protocols.map((p: { slug: string }) => p.slug));
const rows = radar.rows;
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, the gate wants 100 to 4000`);
for (const slug of snapshot.watchlist) if (!rows.some((r: { slug: string }) => r.slug === slug)) fail(`watchlist slug ${slug} is missing`);
rows.forEach((r: { slug: string; rank: number; implied_value_usd: number; farm_steps: string[] }, i: number) => {
  if (!known.has(r.slug)) fail(`${r.slug} is not in the snapshot`);
  if (r.rank !== i + 1) fail(`${r.slug} has rank ${r.rank} at position ${i + 1}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) fail(`${r.slug} is worth more than the row above it`);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1) fail(`${r.slug} has no whole implied value`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug} has ${r.farm_steps.length} farm steps`);
  for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) fail(`${r.slug} has a farm step of ${s.trim().length} characters`);
});

const board = rows.map((r: any) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  implied_value_usd: r.implied_value_usd,
  tier: r.tier,
  token_status: r.token_status,
  category: r.category,
  chains: r.chains,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  listed_at: r.listed_at,
  age_days: r.age_days,
  model: r.model,
  launch_odds: Number(r.launch_odds.toFixed(4)),
  airdrop_per_1k_usd: Number(r.airdrop_per_1k.toFixed(2)),
  farm: { chain: r.plan.chain, capital_usd: r.plan.capital, hold_days: r.plan.hold_days, setup_cost_usd: Number(r.plan.setup_cost.toFixed(2)), monthly_cost_usd: Number(r.plan.monthly_cost.toFixed(2)) },
  farm_steps: r.farm_steps,
}));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: Model.VERSION, as_of: snapshot.as_of, source: snapshot.source, constants: Model.CONST, rows: board })}\n`);

// The page gets the snapshot itself and runs the model on it.
const page = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, watchlist: snapshot.watchlist, protocols: snapshot.protocols };
writeFileSync(join(out, 'data.js'), `window.RADAR_SNAPSHOT = ${JSON.stringify(page)};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !statSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    names.push(name);
  }
  return names;
}

const files = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images, hand in 3 or 4`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(`launch radar: ${rows.length} pre-token rows (${snapshot.watchlist.length} watchlist), ${radar.live.length} live tokens set apart, ${radar.aside.length} set aside; ${files.length} dashboard files, ${shots.length} screenshots\n`);
