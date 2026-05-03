(function () {
  'use strict';

  var PLUGIN_ID = 'nodebb-plugin-wkchat-list';
  var VERSION = '19.10.6-safe1';
  var ASSET_BASE = '/plugins/' + PLUGIN_ID + '/public';
  var engineLoaded = false;
  var engineLoading = null;

  window.__wkChatListClientVersion = VERSION;

  function relPath() {
    return (window.config && window.config.relative_path) || '';
  }

  function cleanPath(path) {
    path = String(path || window.location.pathname || '');
    var rp = relPath();
    if (rp && path.indexOf(rp) === 0) path = path.slice(rp.length);
    return path.replace(/^\/+/, '').split('?')[0].split('#')[0];
  }

  function isChats(path) {
    return /^(user\/[^/]+\/)?chats(\/[^/]+)?$/.test(cleanPath(path));
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-wkchat-list-engine="1"]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        if (engineLoaded || (window.WKChat && window.WKChat.version)) resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.wkchatListEngine = '1';
      s.onload = function () { engineLoaded = true; resolve(); };
      s.onerror = reject;
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function fetchConfig() {
    return fetch(relPath() + '/api/plugins/wkchat-list/config', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).then(function (r) {
      if (!r.ok) throw new Error('config ' + r.status);
      return r.json();
    }).catch(function () {
      return {
        enabled: true,
        bridgeBases: ['/bridge', '/wkbridge', ''],
        conversationSyncPath: '/conversation/sync',
        openPathPattern: '/user/{slug}/chats/{roomId}',
        pollMs: 12000,
        pollErrorMs: 6000,
        debug: false,
      };
    });
  }

  function applyConfig(cfg) {
    cfg = cfg || {};
    window.WKChatConfig = {
      bridgeBases: Array.isArray(cfg.bridgeBases) && cfg.bridgeBases.length ? cfg.bridgeBases : ['/bridge', '/wkbridge', ''],
      conversationSyncPath: cfg.conversationSyncPath || '/conversation/sync',
      openPathPattern: cfg.openPathPattern || '/user/{slug}/chats/{roomId}',
      pollMs: Number(cfg.pollMs) || 12000,
      pollErrorMs: Number(cfg.pollErrorMs) || 6000,
      debug: !!cfg.debug,
    };
  }

  function boot() {
    if (!isChats()) {
      if (window.WKChat && typeof window.WKChat.unmount === 'function') {
        try { window.WKChat.unmount(); } catch (e) {}
      }
      return;
    }

    fetchConfig().then(function (cfg) {
      if (!cfg || cfg.enabled === false) {
        if (window.WKChat && typeof window.WKChat.unmount === 'function') {
          try { window.WKChat.unmount(); } catch (e) {}
        }
        return;
      }
      applyConfig(cfg);
      if (engineLoaded || (window.WKChat && window.WKChat.version)) {
        if (window.WKChat && typeof window.WKChat.mount === 'function') window.WKChat.mount();
        return;
      }
      if (!engineLoading) {
        engineLoading = loadScript(ASSET_BASE + '/src/wkchat.js?v=' + encodeURIComponent(VERSION));
      }
      engineLoading.then(function () {
        if (window.WKChat && typeof window.WKChat.mount === 'function') window.WKChat.mount();
      }).catch(function (err) {
        if (window.console && console.warn) console.warn('[WKChat List] engine load failed', err);
      });
    });
  }

  if (window.jQuery) {
    window.jQuery(document).ready(boot);
    window.jQuery(window).on('action:ajaxify.end', boot);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
    window.addEventListener('popstate', boot);
  }
  window.addEventListener('pageshow', boot);
})();
