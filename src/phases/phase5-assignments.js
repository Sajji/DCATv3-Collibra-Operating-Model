import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from '../client.js';
import { log } from '../logger.js';
import { loadState, saveState, recordPhaseComplete } from '../state.js';
import { assertStateHas } from '../verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadJSON(name) {
  return JSON.parse(await readFile(resolve(__dirname, '..', '..', 'data', name), 'utf-8'));
}

async function ensureAssignment(spec, state) {
  const assetType = state.assetTypes[spec.assetTypeKey];
  if (!assetType?.id) {
    throw new Error(`Assignment: cannot resolve asset type "${spec.assetTypeKey}". Run phase 1.`);
  }

  const statusIds = spec.statusKeys.map(k => {
    const s = state.statuses[k];
    if (!s?.id) {
      throw new Error(`Assignment for "${assetType.name}": cannot resolve status "${k}". Run phase 4.`);
    }
    return s.id;
  });

  const characteristicTypes = [];

  for (const c of spec.characteristicTypes || []) {
    const at = state.attributeTypes[c.attributeTypeKey];
    if (!at?.id) {
      throw new Error(
        `Assignment for "${assetType.name}": cannot resolve attribute "${c.attributeTypeKey}". Run phase 2.`
      );
    }
    characteristicTypes.push({
      id: at.id,
      type: 'AttributeType',
      min: c.min,
      max: c.max,
    });
  }

  for (const rk of spec.relationTypeKeys || []) {
    const rt = state.relationTypes[rk];
    if (!rt?.id) {
      throw new Error(
        `Assignment for "${assetType.name}": cannot resolve relation "${rk}". Run phase 3.`
      );
    }
    // Direction: TO_TARGET means the asset type acts as the source of the relation;
    //            TO_SOURCE means it acts as the target. Pick based on which side this asset type is on.
    const direction = rt.sourceTypeId === assetType.id ? 'TO_TARGET' : 'TO_SOURCE';
    characteristicTypes.push({
      id: rt.id,
      type: 'RelationType',
      relationTypeDirection: direction,
    });
  }

  // The Collibra API does not expose a clean "find assignment by assetType+scope" call,
  // so we attempt the create and treat 4xx duplicate errors as success.
  log.info(
    `Assigning ${characteristicTypes.length} characteristics + ${statusIds.length} statuses to "${assetType.name}"`
  );
  try {
    const created = await client.addAssignment({
      assetTypeId: assetType.id,
      statusIds,
      characteristicTypes,
    });
    if (!created.dryRun) {
      state.assignments[spec.assetTypeKey] = { id: created.id, assetTypeId: assetType.id };
    }
    return created;
  } catch (err) {
    // Existing assignment for the global scope on this asset type: log and continue.
    if (err.status === 409 || /already exists|duplicate/i.test(String(err.message))) {
      log.info(`Assignment already exists for "${assetType.name}". Skipping.`);
      state.assignments[spec.assetTypeKey] = state.assignments[spec.assetTypeKey] || { id: null, assetTypeId: assetType.id };
      return { existing: true };
    }
    throw err;
  }
}

export async function runPhase5() {
  log.info('=== Phase 5: Assignments (wire statuses + attributes + relations to asset types) ===');
  const state = await loadState();
  assertStateHas(state.assetTypes, ['catalog', 'dataset', 'distribution', 'dataService'], 'Phase 5');
  if (Object.keys(state.statuses).length === 0) {
    throw new Error('Phase 5 requires statuses from phase 4. Run phase 4 first.');
  }

  const data = await loadJSON('statuses.json');
  for (const spec of data.assignments) {
    await ensureAssignment(spec, state);
    await saveState();
  }

  await recordPhaseComplete(5);
  log.info('Phase 5 complete.');
}

export async function verifyPhase5() {
  const state = await loadState();
  const data = await loadJSON('statuses.json');
  const errors = [];
  for (const a of data.assignments) {
    if (!state.assignments[a.assetTypeKey]) {
      errors.push(`assignment for "${a.assetTypeKey}" not recorded`);
    }
  }
  if (errors.length) {
    log.error(`Phase 5 verification failed (${errors.length} issues):`);
    errors.forEach(e => log.error('  - ' + e));
    return false;
  }
  log.info(`Phase 5 verified: ${Object.keys(state.assignments).length} assignments.`);
  return true;
}
