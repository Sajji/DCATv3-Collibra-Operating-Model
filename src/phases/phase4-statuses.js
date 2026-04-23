import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from '../client.js';
import { log } from '../logger.js';
import { loadState, saveState, recordPhaseComplete } from '../state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadJSON(name) {
  return JSON.parse(await readFile(resolve(__dirname, '..', '..', 'data', name), 'utf-8'));
}

async function ensureStatus(spec, state) {
  const existing = await client.findStatusByName(spec.name);
  if (existing) {
    log.info(`Status already exists: "${spec.name}" (${existing.id})`);
    state.statuses[spec.key] = { id: existing.id, name: existing.name };
    return existing;
  }
  log.info(`Creating status: "${spec.name}"`);
  const created = await client.addStatus({
    name: spec.name,
    description: spec.description,
  });
  if (!created.dryRun) {
    state.statuses[spec.key] = { id: created.id, name: created.name };
  }
  return created;
}

export async function runPhase4() {
  log.info('=== Phase 4: Statuses ===');
  const state = await loadState();
  const data = await loadJSON('statuses.json');
  for (const spec of data.statuses) {
    await ensureStatus(spec, state);
    await saveState();
  }
  await recordPhaseComplete(4);
  log.info('Phase 4 complete.');
}

export async function verifyPhase4() {
  const state = await loadState();
  const data = await loadJSON('statuses.json');
  const errors = [];
  for (const s of data.statuses) {
    if (!state.statuses[s.key]?.id) errors.push(`status "${s.name}" not created`);
  }
  if (errors.length) {
    log.error(`Phase 4 verification failed (${errors.length} issues):`);
    errors.forEach(e => log.error('  - ' + e));
    return false;
  }
  log.info(`Phase 4 verified: ${Object.keys(state.statuses).length} statuses.`);
  return true;
}
