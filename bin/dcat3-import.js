#!/usr/bin/env node
import { runPhase, runAll, verifyAll, PHASES } from '../src/phases/index.js';
import { verifyAuth } from '../src/verify.js';
import { loadState, getStatePath } from '../src/state.js';
import { rollback } from '../src/rollback.js';
import { log } from '../src/logger.js';
import { config } from '../src/config.js';

const HELP = `
DCAT-US 3.0 Collibra import tool

Usage:
  dcat3-import verify              Verify auth and report current state from state.json
  dcat3-import phase <n>           Run phase <n> (1..5). Each phase is idempotent and verified.
  dcat3-import all                 Run every phase in order, with verification after each.
  dcat3-import status              Print a summary of what's been created so far.
  dcat3-import rollback --confirm  Delete every DCAT3 object created by this tool, in reverse order.

Phases:
${Object.entries(PHASES)
  .map(([n, p]) => `  ${n}. ${p.name}`)
  .join('\n')}

Environment (set via .env):
  COLLIBRA_BASE_URL, COLLIBRA_USERNAME, COLLIBRA_PASSWORD   (required)
  DRY_RUN=true|false                                        (default false)
  HTTP_TIMEOUT_MS=30000                                     (default 30000)
  LOG_LEVEL=debug|info|warn|error                           (default info)
`;

async function cmdStatus() {
  const s = await loadState();
  log.info(`State file: ${getStatePath()}`);
  log.info(`Created at: ${s.createdAt || 'never'}`);
  log.info(`Last updated: ${s.lastUpdated || 'never'}`);
  log.info(`Phases completed: ${s.phasesCompleted.length === 0 ? 'none' : s.phasesCompleted.join(', ')}`);
  log.info(`Community: ${s.community ? `"${s.community.name}" (${s.community.id})` : 'not created'}`);
  log.info(`Domains: ${Object.keys(s.domains).length}`);
  log.info(`Asset types: ${Object.keys(s.assetTypes).length}`);
  log.info(`Attribute types: ${Object.keys(s.attributeTypes).length}`);
  log.info(`Relation types: ${Object.keys(s.relationTypes).length}`);
  log.info(`Complex relation types: ${Object.keys(s.complexRelationTypes).length}`);
  log.info(`Statuses: ${Object.keys(s.statuses).length}`);
  log.info(`Assignments: ${Object.keys(s.assignments).length}`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  log.info(`Target: ${config.baseUrl}  (dry-run: ${config.dryRun})`);

  switch (cmd) {
    case 'verify': {
      await verifyAuth();
      await cmdStatus();
      const ok = await verifyAll();
      if (!ok) {
        log.warn('One or more phases have outstanding gaps; re-run the relevant phase to repair.');
        process.exit(2);
      }
      break;
    }
    case 'status': {
      await cmdStatus();
      break;
    }
    case 'phase': {
      const n = parseInt(args[0], 10);
      if (!Number.isInteger(n)) {
        console.error('phase requires a number, e.g. `phase 2`');
        process.exit(1);
      }
      await verifyAuth();
      await runPhase(n);
      break;
    }
    case 'all': {
      await verifyAuth();
      await runAll();
      break;
    }
    case 'rollback': {
      const confirm = args.includes('--confirm');
      if (!confirm) {
        console.error('rollback is destructive. Re-run with --confirm to proceed.');
        process.exit(1);
      }
      await verifyAuth();
      await rollback({ confirm: true });
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => {
  log.error(err.message || String(err));
  if (err.body) log.error('Response body:', err.body);
  if (process.env.LOG_LEVEL === 'debug') console.error(err.stack);
  process.exit(1);
});
