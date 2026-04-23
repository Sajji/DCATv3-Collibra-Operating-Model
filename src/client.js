import { config } from './config.js';
import { log } from './logger.js';

/**
 * Thin wrapper around Collibra Core REST 2.0.
 * - Basic auth (configurable via env)
 * - Honors DRY_RUN: GETs go through, POST/PATCH/DELETE are logged and skipped
 * - Pageable search helpers used for idempotency checks
 */
export class CollibraClient {
  constructor() {
    const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    this.authHeader = `Basic ${token}`;
    this.apiBase = config.apiBase;
    this.timeoutMs = config.timeoutMs;
    this.dryRun = config.dryRun;

    if (config.allowSelfSignedCert) {
      // Node's fetch uses TLS verification by default. Allow opting out for on-prem/self-signed setups.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      log.warn('ALLOW_SELF_SIGNED_CERT=true: TLS certificate validation is disabled.');
    }
  }

  async _request(method, path, { body, query } = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const isMutation = method !== 'GET' && method !== 'HEAD';
    if (this.dryRun && isMutation) {
      log.info(`[DRY-RUN] ${method} ${url.pathname}${url.search}`, body);
      return { dryRun: true };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);

    log.debug(`${method} ${url.pathname}${url.search}`);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(t);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeoutMs}ms: ${method} ${url.pathname}`);
      }
      throw err;
    }
    clearTimeout(t);

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        typeof parsed === 'object' && parsed
          ? parsed.titleMessage || parsed.message || JSON.stringify(parsed)
          : String(parsed || res.statusText);
      const err = new Error(
        `Collibra ${method} ${url.pathname} failed with ${res.status}: ${msg}`
      );
      err.status = res.status;
      err.body = parsed;
      throw err;
    }

    return parsed;
  }

  // -------- Auth --------
  async getCurrentSession() {
    return this._request('GET', '/auth/sessions/current');
  }

  // -------- Search helpers --------
  async findCommunityByName(name) {
    const res = await this._request('GET', '/communities', {
      query: { name, nameMatchMode: 'EXACT', limit: 5 },
    });
    return (res?.results || []).find(c => c.name === name) || null;
  }

  async findDomainByName(name, communityId) {
    const res = await this._request('GET', '/domains', {
      query: { name, nameMatchMode: 'EXACT', communityId, limit: 10 },
    });
    return (res?.results || []).find(d => d.name === name) || null;
  }

  async findAssetTypeByName(name) {
    const res = await this._request('GET', '/assetTypes', {
      query: { name, nameMatchMode: 'EXACT', limit: 5 },
    });
    return (res?.results || []).find(t => t.name === name) || null;
  }

  async findAttributeTypeByName(name) {
    try {
      // Convenience endpoint /attributeTypes/name/{attributeTypeName} returns a single
      // attribute type by exact name. Returns 404 if absent.
      return await this._request('GET', `/attributeTypes/name/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async findRelationType({ sourceTypeId, role, coRole, targetTypeId }) {
    const res = await this._request('GET', '/relationTypes', {
      query: { sourceTypeId, targetTypeId, role, coRole, limit: 5 },
    });
    return (
      (res?.results || []).find(
        r =>
          r.sourceType?.id === sourceTypeId &&
          r.targetType?.id === targetTypeId &&
          r.role === role &&
          r.coRole === coRole
      ) || null
    );
  }

  async findComplexRelationTypeByName(name) {
    const res = await this._request('GET', '/complexRelationTypes', {
      query: { name, nameMatchMode: 'EXACT', limit: 5 },
    });
    return (res?.results || []).find(t => t.name === name) || null;
  }

  async findStatusByName(name) {
    try {
      return await this._request('GET', `/statuses/name/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  // -------- Create endpoints (single) --------
  addCommunity(body) {
    return this._request('POST', '/communities', { body });
  }
  addDomain(body) {
    return this._request('POST', '/domains', { body });
  }
  addAssetType(body) {
    return this._request('POST', '/assetTypes', { body });
  }
  addAttributeType(body) {
    return this._request('POST', '/attributeTypes', { body });
  }
  addRelationType(body) {
    return this._request('POST', '/relationTypes', { body });
  }
  addComplexRelationType(body) {
    return this._request('POST', '/complexRelationTypes', { body });
  }
  addStatus(body) {
    return this._request('POST', '/statuses', { body });
  }
  addAssignment(body) {
    return this._request('POST', '/assignments', { body });
  }
  addAsset(body) {
    return this._request('POST', '/assets', { body });
  }

  // -------- Bulk create --------
  addAssetTypesBulk(bodies) {
    return this._request('POST', '/assetTypes/bulk', { body: bodies });
  }
  addAttributeTypesBulk(bodies) {
    return this._request('POST', '/attributeTypes/bulk', { body: bodies });
  }
  addRelationTypesBulk(bodies) {
    return this._request('POST', '/relationTypes/bulk', { body: bodies });
  }
  addStatusesBulk(bodies) {
    return this._request('POST', '/statuses/bulk', { body: bodies });
  }
  addAssetsBulk(bodies) {
    return this._request('POST', '/assets/bulk', { body: bodies });
  }

  // -------- Delete (used by rollback) --------
  removeCommunity(id) {
    return this._request('DELETE', `/communities/${id}`);
  }
  removeAssetType(id) {
    return this._request('DELETE', `/assetTypes/${id}`);
  }
  removeAttributeType(id) {
    return this._request('DELETE', `/attributeTypes/${id}`);
  }
  removeRelationType(id) {
    return this._request('DELETE', `/relationTypes/${id}`);
  }
  removeComplexRelationType(id) {
    return this._request('DELETE', `/complexRelationTypes/${id}`);
  }
  removeStatus(id) {
    return this._request('DELETE', `/statuses/${id}`);
  }
}

export const client = new CollibraClient();
