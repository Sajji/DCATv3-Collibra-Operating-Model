import { client } from './client.js';
import { log } from './logger.js';
import { loadState, saveState } from './state.js';

async function safeDelete(label, fn) {
  try {
    await fn();
    log.info(`  removed ${label}`);
    return true;
  } catch (err) {
    log.warn(`  failed to remove ${label}: ${err.message}`);
    return false;
  }
}

/**
 * Reverse-order teardown. Order matters: assignments → complex relations →
 * relations → attributes → asset types → domains → community.
 *
 * Note: assignments are removed implicitly when their asset type is removed,
 * so we don't iterate them explicitly here.
 */
export async function rollback({ confirm = false } = {}) {
  if (!confirm) {
    log.warn('rollback() requires { confirm: true } to actually delete. Aborting.');
    return;
  }
  const state = await loadState();

  log.info('Rolling back complex relation types...');
  for (const [key, val] of Object.entries(state.complexRelationTypes)) {
    if (await safeDelete(`complex relation "${val.name}"`, () => client.removeComplexRelationType(val.id))) {
      delete state.complexRelationTypes[key];
    }
  }
  await saveState();

  log.info('Rolling back relation types...');
  for (const [key, val] of Object.entries(state.relationTypes)) {
    if (await safeDelete(`relation type "${key}"`, () => client.removeRelationType(val.id))) {
      delete state.relationTypes[key];
    }
  }
  await saveState();

  log.info('Rolling back attribute types...');
  for (const [key, val] of Object.entries(state.attributeTypes)) {
    if (await safeDelete(`attribute type "${val.name}"`, () => client.removeAttributeType(val.id))) {
      delete state.attributeTypes[key];
    }
  }
  await saveState();

  log.info('Rolling back asset types (children before parents)...');
  // Reverse declaration order: children come last in our data, so reverse() works.
  const orderedKeys = Object.keys(state.assetTypes).reverse();
  for (const key of orderedKeys) {
    const val = state.assetTypes[key];
    if (await safeDelete(`asset type "${val.name}"`, () => client.removeAssetType(val.id))) {
      delete state.assetTypes[key];
    }
  }
  await saveState();

  log.info('Rolling back statuses...');
  for (const [key, val] of Object.entries(state.statuses)) {
    if (await safeDelete(`status "${val.name}"`, () => client.removeStatus(val.id))) {
      delete state.statuses[key];
    }
  }
  await saveState();

  log.info('Rolling back community (this also cascades any remaining domains)...');
  if (state.community?.id) {
    if (await safeDelete(`community "${state.community.name}"`, () => client.removeCommunity(state.community.id))) {
      state.community = null;
      state.domains = {};
    }
  }
  await saveState();

  log.info('Rollback finished.');
}
