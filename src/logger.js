import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const prefix = `[${ts()}] ${level.toUpperCase().padEnd(5)}`;
  if (meta !== undefined) {
    // Keep meta on a second line so logs stay scannable
    console.log(`${prefix} ${msg}`);
    console.log('       ', typeof meta === 'string' ? meta : JSON.stringify(meta));
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export const log = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
