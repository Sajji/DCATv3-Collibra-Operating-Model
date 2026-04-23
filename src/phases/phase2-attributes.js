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

function buildAttributeBody(spec) {
  const body = {
    name: spec.name,
    description: spec.description,
    kind: spec.kind,
    statisticsEnabled:
      typeof spec.statisticsEnabled === 'boolean' ? spec.statisticsEnabled : false,
  };
  if (spec.kind === 'STRING' && spec.stringType) {
    body.stringType = spec.stringType;
  }
  if (spec.kind === 'NUMERIC' && typeof spec.isInteger === 'boolean') {
    body.isInteger = spec.isInteger;
  }
  if ((spec.kind === 'SINGLE_VALUE_LIST' || spec.kind === 'MULTI_VALUE_LIST') && spec.allowedValues) {
    body.allowedValues = spec.allowedValues;
  }
  return body;
}

async function ensureAttributeType(spec, state) {
  const existing = await client.findAttributeTypeByName(spec.name);
  if (existing) {
    log.info(`Attribute type already exists: "${spec.name}" (${existing.id})`);
    state.attributeTypes[spec.key] = {
      id: existing.id,
      name: existing.name,
      kind: existing.kind || spec.kind,
    };
    return existing;
  }
  log.info(`Creating attribute type: "${spec.name}" (${spec.kind})`);
  const created = await client.addAttributeType(buildAttributeBody(spec));
  if (!created.dryRun) {
    state.attributeTypes[spec.key] = {
      id: created.id,
      name: created.name,
      kind: created.kind || spec.kind,
    };
  }
  return created;
}

export async function runPhase2() {
  log.info('=== Phase 2: Attribute types ===');
  const state = await loadState();
  if (!state.phasesCompleted.includes(1)) {
    log.warn('Phase 1 has not been recorded as complete. Continuing anyway, but consider running phase 1 first.');
  }
  const data = await loadJSON('attribute-types.json');
  for (const spec of data.attributeTypes) {
    await ensureAttributeType(spec, state);
    await saveState();
  }
  await recordPhaseComplete(2);
  log.info('Phase 2 complete.');
}

export async function verifyPhase2() {
  const state = await loadState();
  const data = await loadJSON('attribute-types.json');
  const errors = [];
  for (const a of data.attributeTypes) {
    if (!state.attributeTypes[a.key]?.id) errors.push(`attribute type "${a.name}" not created`);
  }
  if (errors.length) {
    log.error(`Phase 2 verification failed (${errors.length} issues):`);
    errors.forEach(e => log.error('  - ' + e));
    return false;
  }
  log.info(`Phase 2 verified: ${Object.keys(state.attributeTypes).length} attribute types.`);
  return true;
}
