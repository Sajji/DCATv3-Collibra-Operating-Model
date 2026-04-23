import { client } from './client.js';
import { log } from './logger.js';

/**
 * Verifies authentication by hitting /auth/sessions/current.
 * Returns the session info on success; throws otherwise.
 */
export async function verifyAuth() {
  try {
    const session = await client.getCurrentSession();
    log.info(
      `Authenticated as "${session.userName || session.username || 'unknown'}" ` +
        `(user id: ${session.userId || session.id || 'n/a'})`
    );
    return session;
  } catch (err) {
    log.error('Authentication failed. Check COLLIBRA_BASE_URL, USERNAME and PASSWORD in .env.');
    throw err;
  }
}

/**
 * Returns true if every key in `expected` exists in `actual`.
 * Used to assert the state file has the IDs a phase needs.
 */
export function assertStateHas(actual, requiredKeys, label) {
  const missing = requiredKeys.filter(k => !actual[k]);
  if (missing.length > 0) {
    throw new Error(
      `${label}: state is missing required keys: ${missing.join(', ')}. ` +
        `Run the prerequisite phase first.`
    );
  }
}

/**
 * Verifies that a logical ID present in state still exists in Collibra.
 * Useful at the start of a phase if you suspect something was deleted manually.
 */
export async function verifyAssetTypeExists(id) {
  try {
    await client._request('GET', `/assetTypes/${id}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}
