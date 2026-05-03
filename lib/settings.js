'use strict';

const meta = require.main.require('./src/meta');

const SETTINGS_KEY = 'wkchat-list';

const DEFAULTS = Object.freeze({
  enabled: 'on',
  bridgeBases: '/bridge\n/wkbridge\n',
  conversationSyncPath: '/conversation/sync',
  openPathPattern: '/user/{slug}/chats/{roomId}',
  pollMs: '12000',
  pollErrorMs: '6000',
  debug: 'off',
});

function boolOn(value, defaultOn) {
  if (value === undefined || value === null || value === '') return defaultOn ? 'on' : 'off';
  return value === true || value === 'on' || value === 'true' || value === '1' ? 'on' : 'off';
}

function normalize(raw) {
  const out = Object.assign({}, DEFAULTS, raw || {});
  out.enabled = boolOn(out.enabled, true);
  out.debug = boolOn(out.debug, false);

  const pollMs = parseInt(out.pollMs, 10);
  out.pollMs = String(Number.isFinite(pollMs) ? Math.min(120000, Math.max(3000, pollMs)) : 12000);

  const pollErrorMs = parseInt(out.pollErrorMs, 10);
  out.pollErrorMs = String(Number.isFinite(pollErrorMs) ? Math.min(60000, Math.max(3000, pollErrorMs)) : 6000);

  out.conversationSyncPath = String(out.conversationSyncPath || DEFAULTS.conversationSyncPath).trim() || DEFAULTS.conversationSyncPath;
  out.openPathPattern = String(out.openPathPattern || DEFAULTS.openPathPattern).trim() || DEFAULTS.openPathPattern;
  out.bridgeBases = String(out.bridgeBases || DEFAULTS.bridgeBases)
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .join('\n');

  return out;
}

async function get() {
  const raw = await meta.settings.get(SETTINGS_KEY);
  return normalize(raw);
}

async function ensureDefaults() {
  const current = await get();
  await meta.settings.set(SETTINGS_KEY, current);
  return current;
}

function bridgeBasesArray(value) {
  const arr = String(value || DEFAULTS.bridgeBases)
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean);
  // Keep an empty-string fallback if admin explicitly included a blank final line.
  if (!arr.includes('/bridge')) arr.unshift('/bridge');
  return arr.filter((s, i) => arr.indexOf(s) === i);
}

function toPublicConfig(cfg) {
  return {
    enabled: cfg.enabled === 'on',
    bridgeBases: bridgeBasesArray(cfg.bridgeBases),
    conversationSyncPath: cfg.conversationSyncPath || DEFAULTS.conversationSyncPath,
    openPathPattern: cfg.openPathPattern || DEFAULTS.openPathPattern,
    pollMs: parseInt(cfg.pollMs, 10) || 12000,
    pollErrorMs: parseInt(cfg.pollErrorMs, 10) || 6000,
    debug: cfg.debug === 'on',
    assetBase: '/plugins/nodebb-plugin-wkchat-list/public',
    pluginId: 'nodebb-plugin-wkchat-list',
    version: '19.10.6-safe1',
  };
}

module.exports = {
  SETTINGS_KEY,
  DEFAULTS,
  get,
  normalize,
  ensureDefaults,
  toPublicConfig,
};

