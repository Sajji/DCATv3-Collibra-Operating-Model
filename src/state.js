import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, '..', 'state', 'state.json');

const EMPTY_STATE = {
  version: 1,
  createdAt: null,
  lastUpdated: null,
  phasesCompleted: [],
  community: null,
  domains: {},               // logicalKey -> { id, name }
  assetTypes: {},            // logicalKey -> { id, name, parentId }
  attributeTypes: {},        // logicalKey -> { id, name, kind }
  relationTypes: {},         // logicalKey -> { id, sourceTypeId, targetTypeId, role, coRole }
  complexRelationTypes: {},  // logicalKey -> { id, name }
  statuses: {},              // logicalKey -> { id, name }
  assignments: {},           // assetTypeName -> { id }
};

let cache = null;

export async function loadState() {
  if (cache) return cache;
  if (!existsSync(STATE_PATH)) {
    cache = structuredClone(EMPTY_STATE);
    cache.createdAt = new Date().toISOString();
    return cache;
  }
  const raw = await readFile(STATE_PATH, 'utf-8');
  cache = JSON.parse(raw);
  return cache;
}

export async function saveState() {
  if (!cache) return;
  cache.lastUpdated = new Date().toISOString();
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

export async function recordPhaseComplete(phase) {
  const s = await loadState();
  if (!s.phasesCompleted.includes(phase)) {
    s.phasesCompleted.push(phase);
  }
  await saveState();
}

export function getStatePath() {
  return STATE_PATH;
}
