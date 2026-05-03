'use strict';

const settings = require('./settings');

exports.renderAdmin = async function renderAdmin(req, res) {
  res.render('admin/plugins/wkchat-list', {});
};

exports.getPublicConfig = async function getPublicConfig(req, res) {
  const cfg = await settings.get();
  res.json(settings.toPublicConfig(cfg));
};

exports.health = async function health(req, res) {
  const cfg = await settings.get();
  res.json({
    ok: true,
    enabled: cfg.enabled === 'on',
    bridgeBases: settings.toPublicConfig(cfg).bridgeBases,
    conversationSyncPath: cfg.conversationSyncPath,
    version: '19.10.6-safe1',
  });
};
