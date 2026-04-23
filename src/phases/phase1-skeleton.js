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

async function ensureCommunity(spec) {
  const existing = await client.findCommunityByName(spec.name);
  if (existing) {
    log.info(`Community already exists: "${spec.name}" (${existing.id})`);
    return existing;
  }
  log.info(`Creating community: "${spec.name}"`);
  const created = await client.addCommunity({
    name: spec.name,
    description: spec.description,
  });
  return created;
}

function toDomainTypeArray(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.results)) return res.results;
  return [];
}

function matchDomainType(types, alias) {
  const needle = String(alias || '').trim().toLowerCase();
  if (!needle) return null;

  return (
    types.find(t => String(t.publicId || '').toLowerCase() === needle) ||
    types.find(t => String(t.name || '').toLowerCase() === needle) ||
    types.find(t => String(t.publicId || '').toLowerCase().includes(needle)) ||
    types.find(t => String(t.name || '').toLowerCase().includes(needle)) ||
    null
  );
}

function toAssetTypeArray(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.results)) return res.results;
  return [];
}

function matchAssetType(types, alias) {
  const needle = String(alias || '').trim().toLowerCase();
  if (!needle) return null;

  return (
    types.find(t => String(t.publicId || '').toLowerCase() === needle) ||
    types.find(t => String(t.name || '').toLowerCase() === needle) ||
    types.find(t => String(t.publicId || '').toLowerCase().includes(needle)) ||
    types.find(t => String(t.name || '').toLowerCase().includes(needle)) ||
    null
  );
}

async function resolveDomainTypePublicId(spec) {
  const desired = spec.typePublicId;

  // Fast path: keep existing behavior when tenant supports configured publicId.
  try {
    await client._request('GET', `/domainTypes/publicId/${encodeURIComponent(desired)}`);
    return desired;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const domainTypeRes = await client._request('GET', '/domainTypes', {
    query: { limit: 200 },
  });
  const domainTypes = toDomainTypeArray(domainTypeRes);

  const aliasesByKey = {
    catalog: ['asset domain', 'business asset domain', 'data domain'],
    referenceData: ['code list', 'reference data domain', 'reference domain'],
    stakeholder: ['business asset domain', 'asset domain'],
    governance: ['governance asset domain', 'asset domain', 'business asset domain'],
    spatialTemporal: ['business asset domain', 'asset domain'],
  };

  const aliases = [desired, ...(aliasesByKey[spec.key] || [])];
  for (const alias of aliases) {
    const match = matchDomainType(domainTypes, alias);
    if (match?.publicId) {
      log.warn(
        `Domain type publicId "${desired}" not found for "${spec.name}". ` +
          `Using tenant domain type "${match.publicId}" (${match.name || 'n/a'}).`
      );
      return match.publicId;
    }
  }

  const available = domainTypes
    .map(t => `${t.publicId}${t.name ? ` (${t.name})` : ''}`)
    .join(', ');
  throw new Error(
    `No compatible domain type found for "${spec.name}". Configured type "${desired}" does not exist in this tenant. ` +
      `Available domain types: ${available || '(none returned by API)'}`
  );
}

async function ensureDomain(spec, communityId) {
  const existing = await client.findDomainByName(spec.name, communityId);
  if (existing) {
    log.info(`Domain already exists: "${spec.name}" (${existing.id})`);
    return existing;
  }
  const resolvedTypePublicId = await resolveDomainTypePublicId(spec);
  log.info(`Creating domain: "${spec.name}" (type: ${resolvedTypePublicId})`);
  const created = await client.addDomain({
    name: spec.name,
    communityId,
    typePublicId: resolvedTypePublicId,
    description: spec.description,
  });
  return created;
}

async function resolveParentId(spec, state) {
  if (spec.parentKey) {
    const parent = state.assetTypes[spec.parentKey];
    if (!parent) {
      throw new Error(
        `Asset type "${spec.name}" references parentKey "${spec.parentKey}" but ` +
          `that key has not been created yet. Check ordering in data/asset-types.json.`
      );
    }
    return parent.id;
  }
  if (spec.parentPublicId) {
    // Look up an OOTB asset type by its public ID
    try {
      const parent = await client._request(
        'GET',
        `/assetTypes/publicId/${encodeURIComponent(spec.parentPublicId)}`
      );
      return parent.id;
    } catch (err) {
      if (err.status !== 404) {
        throw new Error(
          `Could not resolve OOTB parent asset type "${spec.parentPublicId}" for "${spec.name}". (${err.message})`
        );
      }

      const assetTypeRes = await client._request('GET', '/assetTypes', {
        query: { limit: 500 },
      });
      const assetTypes = toAssetTypeArray(assetTypeRes);

      const aliasesByPublicId = {
        CodeList: ['codelist', 'code list', 'codeset', 'code set'],
        CodeValue: ['codevalue', 'code value'],
        BusinessAsset: ['business asset'],
        GovernanceAsset: ['governance asset'],
        TechnicalAsset: ['technical asset', 'technologyasset', 'technology asset'],
      };

      const aliases = [
        spec.parentPublicId,
        ...(aliasesByPublicId[spec.parentPublicId] || []),
      ];

      for (const alias of aliases) {
        const match = matchAssetType(assetTypes, alias);
        if (match?.id) {
          log.warn(
            `Parent asset type publicId "${spec.parentPublicId}" not found for "${spec.name}". ` +
              `Using tenant asset type "${match.publicId || match.name}".`
          );
          return match.id;
        }
      }

      const available = assetTypes
        .filter(t => t.publicId)
        .map(t => `${t.publicId}${t.name ? ` (${t.name})` : ''}`)
        .join(', ');
      throw new Error(
        `Could not resolve OOTB parent asset type "${spec.parentPublicId}" for "${spec.name}". ` +
          `Available asset type publicIds: ${available || '(none returned by API)'}`
      );
    }
  }
  return undefined;
}

async function ensureAssetType(spec, state) {
  const existing = await client.findAssetTypeByName(spec.name);
  if (existing) {
    log.info(`Asset type already exists: "${spec.name}" (${existing.id})`);
    state.assetTypes[spec.key] = {
      id: existing.id,
      name: existing.name,
      parentId: existing.parent?.id || null,
    };
    return existing;
  }
  const parentId = await resolveParentId(spec, state);
  log.info(`Creating asset type: "${spec.name}"${parentId ? ` (parent ${parentId})` : ''}`);
  const body = {
    name: spec.name,
    description: spec.description,
    displayNameEnabled: true,
    ratingEnabled: false,
    symbolType: spec.symbolType || 'NONE',
    parentId,
  };
  if (spec.iconCode) body.iconCode = spec.iconCode;
  if (spec.acronymCode) body.acronymCode = spec.acronymCode;
  if (spec.color) body.color = spec.color;

  const created = await client.addAssetType(body);
  if (!created.dryRun) {
    state.assetTypes[spec.key] = {
      id: created.id,
      name: created.name,
      parentId: parentId || null,
    };
  }
  return created;
}

export async function runPhase1() {
  log.info('=== Phase 1: Community, domains, and asset types ===');
  const state = await loadState();
  const community = await loadJSON('community.json');
  const assetTypes = await loadJSON('asset-types.json');

  // 1. Community
  const createdCommunity = await ensureCommunity(community.community);
  if (!createdCommunity.dryRun) {
    state.community = { id: createdCommunity.id, name: createdCommunity.name };
  }
  await saveState();

  // 2. Domains (under the community)
  for (const dspec of community.domains) {
    if (!state.community?.id) {
      log.warn(`Skipping domain "${dspec.name}" — community not yet persisted (dry-run?).`);
      continue;
    }
    const created = await ensureDomain(dspec, state.community.id);
    if (!created.dryRun) {
      state.domains[dspec.key] = { id: created.id, name: created.name };
    }
  }
  await saveState();

  // 3. Asset types in declaration order (parents before children)
  for (const aspec of assetTypes.assetTypes) {
    await ensureAssetType(aspec, state);
    await saveState();
  }

  await recordPhaseComplete(1);
  log.info('Phase 1 complete.');
}

export async function verifyPhase1() {
  const state = await loadState();
  const errors = [];
  if (!state.community?.id) errors.push('community is missing');
  const community = await loadJSON('community.json');
  for (const d of community.domains) {
    if (!state.domains[d.key]?.id) errors.push(`domain "${d.name}" not created`);
  }
  const assetTypes = await loadJSON('asset-types.json');
  for (const a of assetTypes.assetTypes) {
    if (!state.assetTypes[a.key]?.id) errors.push(`asset type "${a.name}" not created`);
  }
  if (errors.length) {
    log.error(`Phase 1 verification failed (${errors.length} issues):`);
    errors.forEach(e => log.error('  - ' + e));
    return false;
  }
  log.info(
    `Phase 1 verified: 1 community, ${Object.keys(state.domains).length} domains, ` +
      `${Object.keys(state.assetTypes).length} asset types.`
  );
  return true;
}
