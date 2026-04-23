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

function resolveAssetTypeId(state, key, label) {
  const at = state.assetTypes[key];
  if (!at?.id) {
    throw new Error(`${label}: cannot resolve asset type with key "${key}". Run phase 1 first.`);
  }
  return at.id;
}

function resolveAttributeTypeId(state, key, label) {
  const at = state.attributeTypes[key];
  if (!at?.id) {
    throw new Error(`${label}: cannot resolve attribute type with key "${key}". Run phase 2 first.`);
  }
  return at.id;
}

async function ensureRelationType(spec, state) {
  const sourceTypeId = resolveAssetTypeId(state, spec.sourceKey, `Relation type "${spec.key}"`);
  const targetTypeId = resolveAssetTypeId(state, spec.targetKey, `Relation type "${spec.key}"`);

  const existing = await client.findRelationType({
    sourceTypeId,
    targetTypeId,
    role: spec.role,
    coRole: spec.coRole,
  });
  if (existing) {
    log.info(
      `Relation type already exists: ${spec.sourceKey} —[${spec.role}]→ ${spec.targetKey} (${existing.id})`
    );
    state.relationTypes[spec.key] = {
      id: existing.id,
      sourceTypeId,
      targetTypeId,
      role: spec.role,
      coRole: spec.coRole,
    };
    return existing;
  }

  log.info(`Creating relation type: ${spec.sourceKey} —[${spec.role}]→ ${spec.targetKey}`);
  const created = await client.addRelationType({
    sourceTypeId,
    targetTypeId,
    role: spec.role,
    coRole: spec.coRole,
    description: spec.description,
  });
  if (!created.dryRun) {
    state.relationTypes[spec.key] = {
      id: created.id,
      sourceTypeId,
      targetTypeId,
      role: spec.role,
      coRole: spec.coRole,
    };
  }
  return created;
}

async function ensureComplexRelationType(spec, state) {
  const existing = await client.findComplexRelationTypeByName(spec.name);
  if (existing) {
    log.info(`Complex relation type already exists: "${spec.name}" (${existing.id})`);
    state.complexRelationTypes[spec.key] = { id: existing.id, name: existing.name };
    return existing;
  }

  const legTypes = spec.legTypes.map(leg => ({
    role: leg.role,
    coRole: leg.coRole,
    assetTypeId: resolveAssetTypeId(state, leg.assetTypeKey, `Complex relation "${spec.name}" leg`),
    min: leg.min,
    max: leg.max,
  }));

  const attributeTypes = (spec.attributeTypes || []).map(a => ({
    attributeTypeId: resolveAttributeTypeId(state, a.attributeTypeKey, `Complex relation "${spec.name}" attribute`),
    min: a.min,
    max: a.max,
  }));

  log.info(`Creating complex relation type: "${spec.name}"`);
  const body = {
    name: spec.name,
    description: spec.description,
    symbolType: spec.symbolType || 'NONE',
    legTypes,
    attributeTypes,
  };
  if (spec.acronymCode) body.acronymCode = spec.acronymCode;
  if (spec.iconCode) body.iconCode = spec.iconCode;
  if (spec.color) body.color = spec.color;

  const created = await client.addComplexRelationType(body);
  if (!created.dryRun) {
    state.complexRelationTypes[spec.key] = { id: created.id, name: created.name };
  }
  return created;
}

export async function runPhase3() {
  log.info('=== Phase 3: Relation types and complex relation types ===');
  const state = await loadState();
  assertStateHas(state.assetTypes, ['resource', 'dataset', 'catalog'], 'Phase 3');

  const relations = await loadJSON('relation-types.json');
  for (const spec of relations.relationTypes) {
    await ensureRelationType(spec, state);
    await saveState();
  }

  const complex = await loadJSON('complex-relation-types.json');
  for (const spec of complex.complexRelationTypes) {
    await ensureComplexRelationType(spec, state);
    await saveState();
  }

  await recordPhaseComplete(3);
  log.info('Phase 3 complete.');
}

export async function verifyPhase3() {
  const state = await loadState();
  const relations = await loadJSON('relation-types.json');
  const complex = await loadJSON('complex-relation-types.json');
  const errors = [];
  for (const r of relations.relationTypes) {
    if (!state.relationTypes[r.key]?.id) errors.push(`relation type "${r.key}" not created`);
  }
  for (const c of complex.complexRelationTypes) {
    if (!state.complexRelationTypes[c.key]?.id) errors.push(`complex relation "${c.name}" not created`);
  }
  if (errors.length) {
    log.error(`Phase 3 verification failed (${errors.length} issues):`);
    errors.forEach(e => log.error('  - ' + e));
    return false;
  }
  log.info(
    `Phase 3 verified: ${Object.keys(state.relationTypes).length} relation types, ` +
      `${Object.keys(state.complexRelationTypes).length} complex relation types.`
  );
  return true;
}
