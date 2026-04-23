import { runPhase1, verifyPhase1 } from './phase1-skeleton.js';
import { runPhase2, verifyPhase2 } from './phase2-attributes.js';
import { runPhase3, verifyPhase3 } from './phase3-relations.js';
import { runPhase4, verifyPhase4 } from './phase4-statuses.js';
import { runPhase5, verifyPhase5 } from './phase5-assignments.js';
import { log } from '../logger.js';

const PHASES = {
  1: { run: runPhase1, verify: verifyPhase1, name: 'Skeleton (community + domains + asset types)' },
  2: { run: runPhase2, verify: verifyPhase2, name: 'Attribute types' },
  3: { run: runPhase3, verify: verifyPhase3, name: 'Relation + complex relation types' },
  4: { run: runPhase4, verify: verifyPhase4, name: 'Statuses' },
  5: { run: runPhase5, verify: verifyPhase5, name: 'Assignments' },
};

export async function runPhase(n) {
  const p = PHASES[n];
  if (!p) throw new Error(`Unknown phase: ${n}. Valid phases: ${Object.keys(PHASES).join(', ')}`);
  log.info(`Running phase ${n}: ${p.name}`);
  await p.run();
  log.info(`Verifying phase ${n}...`);
  const ok = await p.verify();
  if (!ok) throw new Error(`Phase ${n} verification failed.`);
}

export async function runAll() {
  for (const n of Object.keys(PHASES).map(Number).sort((a, b) => a - b)) {
    await runPhase(n);
  }
  log.info('All phases complete and verified.');
}

export async function verifyAll() {
  let allOk = true;
  for (const n of Object.keys(PHASES).map(Number).sort((a, b) => a - b)) {
    log.info(`Verifying phase ${n}: ${PHASES[n].name}`);
    const ok = await PHASES[n].verify();
    if (!ok) allOk = false;
  }
  return allOk;
}

export { PHASES };
