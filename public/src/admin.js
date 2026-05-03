'use strict';

/* globals $, app, socket */

$(document).ready(function () {
  if (!$('#wkchat-list-settings').length) return;

  function load() {
    socket.emit('admin.settings.get', { hash: 'wkchat-list' }, function (err, settings) {
      if (err) return app.alertError(err.message || err);
      settings = settings || {};
      $('#enabled').prop('checked', settings.enabled !== 'off');
      $('#debug').prop('checked', settings.debug === 'on');
      $('#bridgeBases').val(settings.bridgeBases || '/bridge\n/wkbridge\n');
      $('#conversationSyncPath').val(settings.conversationSyncPath || '/conversation/sync');
      $('#openPathPattern').val(settings.openPathPattern || '/user/{slug}/chats/{roomId}');
      $('#pollMs').val(settings.pollMs || '12000');
      $('#pollErrorMs').val(settings.pollErrorMs || '6000');
    });
  }

  $('#save').on('click', function () {
    var payload = {
      enabled: $('#enabled').is(':checked') ? 'on' : 'off',
      debug: $('#debug').is(':checked') ? 'on' : 'off',
      bridgeBases: $('#bridgeBases').val(),
      conversationSyncPath: $('#conversationSyncPath').val(),
      openPathPattern: $('#openPathPattern').val(),
      pollMs: $('#pollMs').val(),
      pollErrorMs: $('#pollErrorMs').val(),
    };
    socket.emit('admin.settings.set', { hash: 'wkchat-list', values: payload }, function (err) {
      if (err) return app.alertError(err.message || err);
      app.alertSuccess('WKChat List 设置已保存，请重新 build 并重启 NodeBB。');
    });
  });

  load();
});
