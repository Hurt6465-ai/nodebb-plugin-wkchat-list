'use strict';

const controllers = require('./lib/controllers');
const settings = require('./lib/settings');

const plugin = {};

plugin.init = async function init(params) {
  const router = params.router;
  const middleware = params.middleware;

  router.get('/admin/plugins/wkchat-list', middleware.admin.buildHeader, controllers.renderAdmin);
  router.get('/api/admin/plugins/wkchat-list', controllers.renderAdmin);

  router.get('/api/plugins/wkchat-list/config', controllers.getPublicConfig);
  router.get('/api/plugins/wkchat-list/health', controllers.health);

  await settings.ensureDefaults();
};

plugin.addAdminNavigation = async function addAdminNavigation(header) {
  header.plugins = header.plugins || [];
  header.plugins.push({
    route: '/plugins/wkchat-list',
    icon: 'fa-comments-o',
    name: 'WKChat List',
  });
  return header;
};

module.exports = plugin;
