/*
 * WKChat 19.10.6-wk-data-nbb-open
 * NodeBB 自定义 JS 完整版
 *
 * 目标：
 * 1) 会话列表数据来自悟空 bridge 的 /conversation/sync。
 * 2) 不请求 /token，不做同步注册，不监听悟空事件，不 tap wkws。
 * 3) 点击会话打开 NodeBB 聊天路由 /user/{slug}/chats/{roomId}，由现有悟空聊天窗口接管。
 * 4) 修复未读点击后不清零：本地 readAt 立即清零并持久化，后续同步时 lastTs <= readAt 的未读强制显示 0。
 * 5) 修复先闪 NodeBB 原样式：脚本最前面设置 probe，并注入关键隐藏 CSS。
 */
(function (W, D) {
  'use strict';

  var VERSION = '19.10.6-wk-data-nbb-open-plugin-safe1';
  W.__wkChatListPluginVersion = VERSION;

  if (W.WKChat && W.WKChat.version === VERSION && W.__wkChat19106) return;

  try {
    if (W.WKChat && typeof W.WKChat.unmount === 'function') {
      W.WKChat.unmount();
    }
  } catch (e) {}

  W.__wkChat19106 = true;

  var C = W.WKChatConfig || {};
  var BRIDGE_BASES = Array.isArray(C.bridgeBases) && C.bridgeBases.length
    ? C.bridgeBases
    : ['/bridge', '/wkbridge', ''];
  var CONVERSATION_SYNC_PATH = C.conversationSyncPath || '/conversation/sync';
  var OPEN_PATH_PATTERN = C.openPathPattern || '/user/{slug}/chats/{roomId}';
  var DEBUG = !!C.debug;

  var MAX_CONV = 200;
  var SYNC_PAGE = 200;
  var POLL_MS = C.pollMs || 12000;
  var POLL_ERROR_MS = C.pollErrorMs || 6000;
  var SYNC_DEBOUNCE_MS = 500;
  var SAVE_THROTTLE_MS = 1000;

  var ROOT_ID = 'wk-root';
  var STYLE_ID = 'wk-19106-critical-style';

  function log() {
    if (!DEBUG || !W.console || typeof W.console.log !== 'function') return;
    var args = ['[WKChat ' + VERSION + ']'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    try { W.console.log.apply(W.console, args); } catch (e) {}
  }

  function warn() {
    if (!W.console || typeof W.console.warn !== 'function') return;
    var args = ['[WKChat ' + VERSION + ']'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    try { W.console.warn.apply(W.console, args); } catch (e) {}
  }

  function basePath() {
    return (W.config && W.config.relative_path) || '';
  }

  function myUid() {
    return String(
      (W.app && W.app.user && W.app.user.uid) ||
      (W.config && W.config.uid) ||
      ''
    );
  }

  function mySlug() {
    return String(
      (W.app && W.app.user && W.app.user.userslug) ||
      (W.config && W.config.userslug) ||
      ''
    );
  }

  function csrfToken() {
    return (W.config && W.config.csrf_token) || '';
  }

  function isNumericId(v) {
    return /^\d+$/.test(String(v || ''));
  }

  function cleanPath(path) {
    path = String(path || '');
    var bp = basePath();
    if (bp && path.indexOf(bp) === 0) path = path.slice(bp.length);
    return path.replace(/^\/+/, '').split('?')[0].split('#')[0];
  }

  function isChats(path) {
    return /^(user\/[^/]+\/)?chats(\/[^/]+)?$/.test(cleanPath(path || W.location.pathname));
  }

  function routeRoomId() {
    var p = cleanPath(W.location.pathname);
    var m = p.match(/(?:^|\/)chats\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function setDocFlag(name, value) {
    if (value) {
      D.documentElement.setAttribute(name, '1');
      if (D.body) D.body.setAttribute(name, '1');
    } else {
      D.documentElement.removeAttribute(name);
      if (D.body) D.body.removeAttribute(name);
    }
  }

  function injectCriticalStyle() {
    if (D.getElementById(STYLE_ID)) return;
    var style = D.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'html[data-wk-probe="1"] [component="chat/nav-wrapper"] > *:not(#wk-root),',
      'body[data-wk-probe="1"] [component="chat/nav-wrapper"] > *:not(#wk-root),',
      'html[data-wk="1"] [component="chat/nav-wrapper"] > *:not(#wk-root),',
      'body[data-wk="1"] [component="chat/nav-wrapper"] > *:not(#wk-root){display:none!important}',
      'html[data-wk-probe="1"] [component="chat/nav-wrapper"],',
      'body[data-wk-probe="1"] [component="chat/nav-wrapper"],',
      'html[data-wk="1"] [component="chat/nav-wrapper"],',
      'body[data-wk="1"] [component="chat/nav-wrapper"]{padding:0!important;margin:0!important;position:relative!important;min-height:320px!important}',
      '#wk-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;}',
      'html[data-wk-probe="1"] #wk-root,body[data-wk-probe="1"] #wk-root,html[data-wk="1"] #wk-root,body[data-wk="1"] #wk-root{display:flex!important;}'
    ].join('\n');
    (D.head || D.documentElement).appendChild(style);
  }

  // 尽可能早隐藏 NodeBB 原生列表，减少闪烁。
  injectCriticalStyle();
  if (isChats()) setDocFlag('data-wk-probe', true);

  function toMs(ts, fallback) {
    if (ts === null || typeof ts === 'undefined' || ts === '') return fallback || Date.now();
    if (typeof ts === 'string' && isNaN(+ts)) {
      var p = new Date(ts).getTime();
      return isNaN(p) ? (fallback || Date.now()) : p;
    }
    var n = +ts;
    if (!n) return fallback || Date.now();
    return n < 1e12 ? n * 1000 : n;
  }

  function stripHtml(s) {
    return String(s == null ? '' : s).replace(/<[^>]+>/g, '');
  }

  function trimText(s, n) {
    s = stripHtml(s).replace(/\s+/g, ' ').trim();
    n = n || 50;
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(toMs(ts, 0));
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.floor((today - tDay) / 864e5);
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    if (diff === 0) return p(d.getHours()) + ':' + p(d.getMinutes());
    if (diff === 1) return '昨天';
    if (diff < 7) return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function avatarFallback(name) {
    var ch = String(name || '用').charAt(0) || '用';
    ch = ch.replace(/[<>&"]/g, '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
      '<rect width="100%" height="100%" rx="64" ry="64" fill="#6c757d"/>' +
      '<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="56" fill="#fff">' + ch + '</text></svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function decodeBytesToText(raw) {
    var arr = null;
    if (!raw) return '';
    if (raw instanceof Uint8Array) arr = raw;
    else if (raw instanceof ArrayBuffer) arr = new Uint8Array(raw);
    else if (Array.isArray(raw)) arr = new Uint8Array(raw);
    else if (raw && raw.type === 'Buffer' && Array.isArray(raw.data)) arr = new Uint8Array(raw.data);
    if (!arr) return '';
    try {
      if (W.TextDecoder) return new TextDecoder('utf-8').decode(arr);
    } catch (e) {}
    var encoded = '';
    for (var i = 0; i < arr.length; i++) encoded += '%' + ('00' + arr[i].toString(16)).slice(-2);
    try { return decodeURIComponent(encoded); } catch (e2) { return ''; }
  }

  function looksLikeBase64Json(s) {
    s = String(s || '').trim();
    if (s.length < 8) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
    // JSON base64 常见开头：eyJ = {"，W3s = [{，ewo = {\n
    return /^(eyJ|e3|W3s|W10|ewo|ew0K)/.test(s);
  }

  function parseMaybeJsonText(txt) {
    txt = String(txt == null ? '' : txt).trim();
    if (!txt) return {};
    if (txt.charAt(0) === '{' || txt.charAt(0) === '[') {
      try { return JSON.parse(txt); } catch (e) { return { text: txt }; }
    }
    return { text: txt };
  }

  function extractWkPayload(m) {
    try {
      if (!m) return {};
      var raw =
        m.payload != null ? m.payload :
        m.content != null ? m.content :
        m.messageContent != null ? m.messageContent :
        m.message_content != null ? m.message_content :
        m.body != null ? m.body :
        null;

      if (raw == null) return {};

      if (typeof raw === 'object' &&
          !(raw instanceof Uint8Array) &&
          !(raw instanceof ArrayBuffer) &&
          !Array.isArray(raw) &&
          !(raw.type === 'Buffer' && Array.isArray(raw.data))) {
        return raw;
      }

      if (typeof raw === 'string') {
        var s = raw.trim();
        if (!s) return {};

        if (s.charAt(0) === '{' || s.charAt(0) === '[') {
          try { return JSON.parse(s); } catch (e0) { return { text: s }; }
        }

        if (/^\d+(?:\s*,\s*\d+)+$/.test(s)) {
          var nums = s.split(',').map(function (x) { return Number(x.trim()); });
          var txtNums = decodeBytesToText(nums);
          return parseMaybeJsonText(txtNums);
        }

        // 不要把 "66" 这种普通文本当成 base64 解码。
        if (looksLikeBase64Json(s)) {
          try {
            var bin = atob(s);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var txtB64 = decodeBytesToText(bytes);
            return parseMaybeJsonText(txtB64);
          } catch (e1) {}
        }

        return { text: s };
      }

      var txt = decodeBytesToText(raw);
      if (txt) return parseMaybeJsonText(txt);
    } catch (e) {
      warn('extractWkPayload failed', e);
    }
    return {};
  }

  function normalizePreview(text) {
    text = String(text == null ? '' : text).trim();
    if (!text) return '[消息]';

    if (text.indexOf('__wkcall__:') === 0) {
      var callRaw = text.slice('__wkcall__:'.length);
      try {
        var call = JSON.parse(callRaw);
        var type = String(call.type || '').toLowerCase();
        if (type === 'ringing') return '[通话邀请]';
        if (type === 'cancel') return '[通话已取消]';
        if (type === 'accept') return '[通话已接听]';
        if (type === 'hangup' || type === 'hang_up') return '[通话结束]';
        return '[通话]';
      } catch (e) {
        return '[通话]';
      }
    }

    if (text === '�' || /^�+$/.test(text)) return '[消息]';
    if (/^\[图片\]|^!\[\]/.test(text)) return '[图片]';
    if (/^\[视频\]/.test(text)) return '[视频]';
    if (/^\[语音/.test(text)) return '[语音]';
    if (/^\[文件/.test(text)) return '[文件]';
    return trimText(text, 50) || '[消息]';
  }

  function getLastTextFromMessage(msg) {
    msg = msg || {};
    var payload = extractWkPayload(msg);
    var t = payload.text || payload.content || payload.message || payload.msg || msg.text || msg.content || msg.payload || '';
    return normalizePreview(t);
  }

  function pick(obj, names) {
    if (!obj) return undefined;
    for (var i = 0; i < names.length; i++) {
      if (obj[names[i]] !== undefined && obj[names[i]] !== null && obj[names[i]] !== '') return obj[names[i]];
    }
    return undefined;
  }

  function parseConversationList(raw) {
    if (!raw) return [];
    var list = raw;
    if (!Array.isArray(list)) {
      list = raw.data || raw.conversations || raw.list || raw.rows || raw.response || raw.result || [];
    }
    if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
    if (list && !Array.isArray(list) && Array.isArray(list.conversations)) list = list.conversations;
    return Array.isArray(list) ? list : [];
  }

  function conversationKey(conv) {
    if (!conv) return '';
    return String(conv.roomId || conv.room_id || conv.nodebb_room_id || conv.channel_id || conv.channelId || conv.uid || conv.to_uid || conv.from_uid || '');
  }

  var Store = {
    uid: '',
    rooms: [],
    byKey: {},
    uidToRoom: {},
    meta: { readAt: {}, pinned: {}, hidden: {}, remarks: {} },
    activeRoom: '',
    _saveTimer: 0,
    _dirty: true,

    init: function (uid) {
      uid = String(uid || '');
      if (this.uid === uid) return;
      this.uid = uid;
      this.rooms = [];
      this.byKey = {};
      this.uidToRoom = {};
      this.meta = { readAt: {}, pinned: {}, hidden: {}, remarks: {} };
      this.activeRoom = routeRoomId();
      try {
        var raw = localStorage.getItem('wkchat_19106_meta_' + uid);
        if (raw) {
          var d = JSON.parse(raw);
          this.meta = d.meta || this.meta;
          this.uidToRoom = d.uidToRoom || {};
          if (!this.meta.readAt) this.meta.readAt = {};
          if (!this.meta.pinned) this.meta.pinned = {};
          if (!this.meta.hidden) this.meta.hidden = {};
          if (!this.meta.remarks) this.meta.remarks = {};
        }
      } catch (e) {}
    },

    save: function () {
      var self = this;
      if (this._saveTimer) return;
      this._saveTimer = setTimeout(function () {
        self._saveTimer = 0;
        try {
          localStorage.setItem('wkchat_19106_meta_' + self.uid, JSON.stringify({
            meta: self.meta,
            uidToRoom: self.uidToRoom
          }));
        } catch (e) {}
      }, SAVE_THROTTLE_MS);
    },

    keysFor: function (convOrId) {
      var out = [];
      function add(v) {
        v = String(v || '');
        if (v && out.indexOf(v) === -1) out.push(v);
      }
      if (convOrId && typeof convOrId === 'object') {
        add(convOrId.key);
        add(convOrId.roomId);
        add(convOrId.room_id);
        add(convOrId.nodebbRoomId);
        add(convOrId.nodebb_room_id);
        add(convOrId.channelId);
        add(convOrId.channel_id);
        add(convOrId.targetUid);
        add(convOrId.uid);
      } else add(convOrId);

      out.slice().forEach(function (k) {
        if (Store.uidToRoom[k]) add(Store.uidToRoom[k]);
      });
      return out;
    },

    getReadAt: function (convOrId) {
      var keys = this.keysFor(convOrId);
      var map = this.meta.readAt || {};
      var out = 0;
      for (var i = 0; i < keys.length; i++) {
        var v = +map[keys[i]] || 0;
        if (v > out) out = v;
      }
      return out;
    },

    markRead: function (convOrId, ts) {
      ts = toMs(ts || Date.now());
      var keys = this.keysFor(convOrId);
      if (!keys.length) return;
      this.meta.readAt = this.meta.readAt || {};
      keys.forEach(function (k) {
        if ((+Store.meta.readAt[k] || 0) < ts) Store.meta.readAt[k] = ts;
      });
      this.save();
    },

    isPinned: function (conv) {
      var keys = this.keysFor(conv);
      for (var i = 0; i < keys.length; i++) if (this.meta.pinned[keys[i]]) return true;
      return false;
    },

    getRemark: function (conv) {
      var keys = this.keysFor(conv);
      for (var i = 0; i < keys.length; i++) if (this.meta.remarks[keys[i]]) return this.meta.remarks[keys[i]];
      return '';
    },

    setRooms: function (rooms) {
      var active = routeRoomId();
      this.activeRoom = active;
      this.rooms = rooms.slice(0, MAX_CONV);
      this.byKey = {};
      for (var i = 0; i < this.rooms.length; i++) {
        var r = this.rooms[i];
        if (active && String(r.roomId || '') === String(active)) {
          r.unread = 0;
          this.markRead(r, Date.now());
        }
        this.byKey[r.key] = r;
        if (r.channelId && r.roomId) this.uidToRoom[String(r.channelId)] = String(r.roomId);
        if (r.targetUid && r.roomId) this.uidToRoom[String(r.targetUid)] = String(r.roomId);
      }
      this._dirty = true;
      this.save();
    }
  };

  function normalizeConversation(c) {
    c = c || {};
    var msg = pick(c, ['last_message', 'lastMessage', 'last_msg', 'lastMsg', 'message', 'msg']) || c;

    var channelId = String(pick(c, ['channel_id', 'channelId', 'channelID', 'to_uid', 'touid', 'target_uid', 'targetUid', 'uid']) || '');
    var roomId = String(pick(c, ['roomId', 'room_id', 'nodebb_room_id', 'nodebbRoomId', 'rid']) || '');
    var targetUid = String(pick(c, ['target_uid', 'targetUid', 'to_uid', 'touid', 'uid', 'channel_id', 'channelId']) || channelId || '');
    var key = roomId || channelId || targetUid || conversationKey(c);

    var ts = pick(c, ['timestamp', 'last_msg_timestamp', 'lastMessageTime', 'last_message_time', 'updated_at', 'updatedAt', 'time']);
    if (!ts && msg) ts = pick(msg, ['timestamp', 'message_time', 'time', 'created_at', 'createdAt']);
    ts = toMs(ts, 0) || Date.now();

    var name = String(pick(c, ['name', 'username', 'displayname', 'displayName', 'title', 'channel_name', 'channelName']) || '用户');
    var avatar = String(pick(c, ['avatar', 'picture', 'avatar_url', 'avatarUrl']) || '');
    var unread = +pick(c, ['unread', 'unread_count', 'unreadCount', 'red_dot', 'reddot']) || 0;
    var preview = getLastTextFromMessage(msg);

    var out = {
      key: String(key || ''),
      roomId: roomId,
      channelId: channelId,
      targetUid: targetUid,
      name: name || '用户',
      avatar: avatar,
      preview: preview,
      ts: ts,
      unread: unread,
      raw: c
    };

    var readAt = Store.getReadAt(out);
    if (readAt && ts <= readAt) out.unread = 0;

    return out.key ? out : null;
  }

  function normalizeRooms(raw) {
    var list = parseConversationList(raw);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = normalizeConversation(list[i]);
      if (r) out.push(r);
    }
    out.sort(function (a, b) {
      if (Store.isPinned(a) !== Store.isPinned(b)) return Store.isPinned(a) ? -1 : 1;
      return (b.ts || 0) - (a.ts || 0);
    });
    return out;
  }

  function joinUrl(base, path) {
    base = String(base || '').replace(/\/+$/, '');
    path = String(path || '');
    if (!path) return base || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    return base + path;
  }

  function bridgeFetch(path, options) {
    options = options || {};
    var idx = 0;
    function one() {
      if (idx >= BRIDGE_BASES.length) return Promise.reject(new Error('bridge_unavailable'));
      var base = BRIDGE_BASES[idx++];
      var url = joinUrl(base, path);
      return fetch(url, options).then(function (res) {
        if (!res.ok) throw new Error('bridge ' + res.status + ' ' + url);
        return res.json();
      }).catch(function (err) {
        log('bridge failed', err && err.message ? err.message : err);
        return one();
      });
    }
    return one();
  }

  var Net = {
    _timer: 0,
    _syncing: false,
    _debounce: 0,
    _lastOk: false,

    start: function () {
      this.stop();
      this.sync();
      var self = this;
      this._timer = setInterval(function () {
        self.sync();
      }, this._lastOk ? POLL_MS : POLL_ERROR_MS);
    },

    stop: function () {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = 0;
      }
      if (this._debounce) {
        clearTimeout(this._debounce);
        this._debounce = 0;
      }
      this._syncing = false;
    },

    debouncedSync: function (delay) {
      var self = this;
      if (this._debounce) clearTimeout(this._debounce);
      this._debounce = setTimeout(function () {
        self._debounce = 0;
        self.sync();
      }, typeof delay === 'number' ? delay : SYNC_DEBOUNCE_MS);
    },

    sync: function () {
      if (this._syncing || !Ctrl.mounted || !isChats()) return;
      this._syncing = true;
      var self = this;
      var body = JSON.stringify({ version: 0, msg_count: 1, perPage: SYNC_PAGE });
      bridgeFetch(CONVERSATION_SYNC_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body
      }).then(function (data) {
        var rooms = normalizeRooms(data);
        Store.setRooms(rooms);
        self._lastOk = true;
        Ctrl.setError(false);
        V.render();
        Ctrl.setReady(true);
      }).catch(function (err) {
        self._lastOk = false;
        warn('conversation sync failed', err && err.message ? err.message : err);
        if (!Store.rooms.length) Ctrl.setError(true, '加载失败，请检查 bridge 反代');
        V.render();
      }).then(function () {
        self._syncing = false;
        Ctrl.setLoading(false);
      });
    }
  };

  function resolveRoomByNodeBB(targetUid) {
    targetUid = String(targetUid || '');
    if (!targetUid || !isNumericId(targetUid)) return Promise.resolve('');

    if (Store.uidToRoom[targetUid]) return Promise.resolve(String(Store.uidToRoom[targetUid]));

    return fetch(basePath() + '/api/v3/chats?perPage=100', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        var payload = json && (json.response || json) || {};
        var rooms = payload.rooms || [];
        for (var i = 0; i < rooms.length; i++) {
          var rm = rooms[i];
          var users = rm.users || [];
          for (var j = 0; j < users.length; j++) {
            if (String(users[j].uid) === targetUid) {
              var rid = String(rm.roomId || rm.room_id || '');
              if (rid) {
                Store.uidToRoom[targetUid] = rid;
                Store.save();
                return rid;
              }
            }
          }
        }
        return '';
      }).then(function (found) {
        if (found) return found;
        return fetch(basePath() + '/api/v3/chats', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-csrf-token': csrfToken()
          },
          body: JSON.stringify({ uids: [parseInt(targetUid, 10)] })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (json) {
            var data = json && (json.response || json) || {};
            var rid = String(data.roomId || data.room_id || '');
            if (rid) {
              Store.uidToRoom[targetUid] = rid;
              Store.save();
            }
            return rid;
          });
      }).catch(function (err) {
        warn('resolveRoomByNodeBB failed', err && err.message ? err.message : err);
        return '';
      });
  }

  function openNodeBBRoom(roomId) {
    roomId = String(roomId || '');
    if (!roomId) return;
    var slug = mySlug();
    var path = OPEN_PATH_PATTERN
      .replace('{slug}', encodeURIComponent(slug))
      .replace('{roomId}', encodeURIComponent(roomId));
    path = path.replace(/^\/+/, '');
    if (W.ajaxify && typeof W.ajaxify.go === 'function') {
      W.ajaxify.go(path);
    } else {
      W.location.href = basePath() + '/' + path;
    }
  }

  function openConversation(conv) {
    if (!conv) return;

    // 先本地清零，避免“点开后会话列表未读不消失”。
    Store.markRead(conv, Date.now());
    conv.unread = 0;
    V.render();

    var roomId = String(conv.roomId || '');
    if (roomId && isNumericId(roomId)) {
      openNodeBBRoom(roomId);
      return;
    }

    // 悟空会话经常只有 channel_id；NodeBB 路由需要 roomId。
    var targetUid = String(conv.targetUid || conv.channelId || '');
    resolveRoomByNodeBB(targetUid).then(function (rid) {
      if (rid) {
        conv.roomId = rid;
        Store.uidToRoom[targetUid] = rid;
        Store.markRead(conv, Date.now());
        Store.save();
        openNodeBBRoom(rid);
      } else {
        warn('无法解析 NodeBB roomId，不能打开聊天窗口', conv);
      }
    });
  }

  var V = {
    root: null,
    list: null,
    empty: null,
    error: null,
    loading: null,

    html: function () {
      return '' +
        '<div class="wk-head" style="display:none"></div>' +
        '<div class="wk-loading" hidden>' + skeletonHtml() + '</div>' +
        '<div class="wk-error" hidden><div class="wk-error-text">加载失败</div><button type="button" class="wk-retry">重试</button></div>' +
        '<div class="wk-list-wrap"><ul class="wk-list"></ul></div>' +
        '<div class="wk-empty" hidden>暂无会话</div>';
    },

    bind: function (root) {
      this.root = root;
      this.list = root.querySelector('.wk-list');
      this.empty = root.querySelector('.wk-empty');
      this.error = root.querySelector('.wk-error');
      this.loading = root.querySelector('.wk-loading');
      var retry = root.querySelector('.wk-retry');
      if (retry && !retry.__wkBound) {
        retry.__wkBound = true;
        retry.addEventListener('click', function () {
          Ctrl.setError(false);
          Ctrl.setLoading(true);
          Net.sync();
        });
      }
      if (this.list && !this.list.__wkBound) {
        this.list.__wkBound = true;
        this.list.addEventListener('click', function (e) {
          var li = e.target;
          while (li && li !== V.list) {
            if (li.classList && li.classList.contains('wk-item')) break;
            li = li.parentNode;
          }
          if (!li || li === V.list) return;
          var key = li.getAttribute('data-key') || '';
          var conv = Store.byKey[key];
          openConversation(conv);
        });
      }
    },

    render: function () {
      if (!this.list) return;
      var rooms = Store.rooms || [];
      var html = [];
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        var name = Store.getRemark(r) || r.name || '用户';
        var avatar = r.avatar || avatarFallback(name);
        var unread = +r.unread || 0;
        var active = r.roomId && String(r.roomId) === String(Store.activeRoom || routeRoomId());
        var badge = unread > 0 ? '<span class="wk-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '';
        html.push(
          '<li class="wk-item" data-key="' + escapeAttr(r.key) + '" data-active="' + (active ? '1' : '0') + '">' +
            '<div class="wk-avatar-wrap"><img class="wk-avatar" src="' + escapeAttr(avatar) + '" alt=""><span class="wk-dot"></span></div>' +
            '<div class="wk-body">' +
              '<div class="wk-row1"><span class="wk-name">' + escapeHtml(name) + '</span><span class="wk-time">' + escapeHtml(fmtTime(r.ts)) + '</span></div>' +
              '<div class="wk-row2"><span class="wk-preview">' + escapeHtml(r.preview || '[消息]') + '</span>' + badge + '</div>' +
            '</div>' +
          '</li>'
        );
      }
      this.list.innerHTML = html.join('');
      if (this.empty) this.empty.hidden = rooms.length !== 0;
      if (this.loading) this.loading.hidden = true;
    }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function skeletonHtml() {
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push('<div class="wk-skel"><div class="wk-skel-av"></div><div class="wk-skel-b"><div></div><div></div></div></div>');
    }
    return out.join('');
  }

  var Ctrl = {
    mounted: false,
    _routeObs: null,

    setReady: function (flag) {
      setDocFlag('data-wk', !!flag);
      if (flag) setDocFlag('data-wk-probe', false);
    },

    setLoading: function (flag) {
      var el = D.querySelector('#' + ROOT_ID + ' .wk-loading');
      if (el) el.hidden = !flag;
    },

    setError: function (flag, msg) {
      var el = D.querySelector('#' + ROOT_ID + ' .wk-error');
      var txt = D.querySelector('#' + ROOT_ID + ' .wk-error-text');
      if (txt && msg) txt.textContent = msg;
      if (el) el.hidden = !flag;
    },

    getNav: function () {
      return D.querySelector('[component="chat/nav-wrapper"]');
    },

    ensureRoot: function () {
      var nav = this.getNav();
      if (!nav) return null;
      var root = D.getElementById(ROOT_ID);
      if (!root || !root.isConnected) {
        root = D.createElement('div');
        root.id = ROOT_ID;
        root.innerHTML = V.html();
        nav.appendChild(root);
      } else if (root.parentNode !== nav) {
        nav.appendChild(root);
      }
      if (!root.querySelector('.wk-list')) root.innerHTML = V.html();
      V.bind(root);
      return root;
    },

    mount: function () {
      if (!isChats()) return;
      var uid = myUid();
      if (!uid) return;
      Store.init(uid);
      Store.activeRoom = routeRoomId();

      setDocFlag('data-wk-probe', true);
      var root = this.ensureRoot();
      if (!root) {
        this.watchRouteContainer();
        return;
      }
      this.mounted = true;
      this.setError(false);
      this.setLoading(!Store.rooms.length);
      V.render();
      this.setReady(true);
      Net.start();
    },

    unmount: function () {
      Net.stop();
      var root = D.getElementById(ROOT_ID);
      if (root) root.remove();
      this.mounted = false;
      this.setReady(false);
      setDocFlag('data-wk-probe', false);
    },

    watchRouteContainer: function () {
      if (this._routeObs || !D.body) return;
      var self = this;
      this._routeObs = new MutationObserver(function () {
        if (!isChats()) return;
        if (self.getNav()) {
          self._routeObs.disconnect();
          self._routeObs = null;
          self.mount();
        }
      });
      this._routeObs.observe(D.body, { childList: true, subtree: true });
    }
  };

  function routeCheck() {
    if (isChats()) {
      setDocFlag('data-wk-probe', true);
      setTimeout(function () { Ctrl.mount(); }, 0);
    } else if (Ctrl.mounted || D.getElementById(ROOT_ID)) {
      Ctrl.unmount();
    } else {
      setDocFlag('data-wk-probe', false);
      setDocFlag('data-wk', false);
    }
  }

  W.WKChat = {
    version: VERSION,
    mount: function () { Ctrl.mount(); },
    unmount: function () { Ctrl.unmount(); },
    sync: function () { Net.sync(); },
    retryLoad: function () { Ctrl.setError(false); Ctrl.setLoading(true); Net.sync(); },
    openRoom: function (id) { openNodeBBRoom(id); },
    debugNow: function () {
      var snap = {
        version: VERSION,
        bridgeBases: BRIDGE_BASES,
        path: W.location.pathname,
        activeRoom: routeRoomId(),
        rooms: Store.rooms.length,
        top: Store.rooms.slice(0, 10).map(function (r) {
          return { key: r.key, roomId: r.roomId, channelId: r.channelId, targetUid: r.targetUid, unread: r.unread, preview: r.preview, ts: r.ts };
        })
      };
      if (W.console && W.console.log) W.console.log('[WKChat debug]', snap);
      return snap;
    },
    store: Store
  };

  if (W.jQuery) {
    W.jQuery(D).ready(routeCheck);
    W.jQuery(W).on('action:ajaxify.end', function () {
      routeCheck();
      if (Ctrl.mounted) Net.debouncedSync(300);
    });
  } else {
    D.addEventListener('DOMContentLoaded', routeCheck);
    W.addEventListener('popstate', routeCheck);
  }

  D.addEventListener('visibilitychange', function () {
    if (!D.hidden && isChats()) {
      routeCheck();
      if (Ctrl.mounted) Net.debouncedSync(200);
    }
  });

  W.addEventListener('focus', function () {
    if (Ctrl.mounted && isChats()) Net.debouncedSync(200);
  });

  W.addEventListener('pageshow', function () {
    routeCheck();
    if (Ctrl.mounted) Net.debouncedSync(200);
  });

  routeCheck();

})(window, document);
