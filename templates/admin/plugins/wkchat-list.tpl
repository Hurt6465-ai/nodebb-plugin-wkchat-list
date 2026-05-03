<div class="wkchat-list-admin">
  <div class="row">
    <div class="col-lg-9">
      <div class="panel panel-default">
        <div class="panel-heading"><h3 class="panel-title">WKChat List</h3></div>
        <div class="panel-body" id="wkchat-list-settings">
          <p class="help-block">会话列表数据来自你的 Wukong bridge <code>/conversation/sync</code>。点击会话后打开 NodeBB 聊天路由，并交给现有聊天窗口插件接管。</p>

          <div class="checkbox">
            <label><input type="checkbox" id="enabled"> 启用 WKChat 会话列表</label>
          </div>

          <div class="form-group">
            <label for="bridgeBases">Bridge 基础路径，一行一个</label>
            <textarea id="bridgeBases" class="form-control" placeholder="/bridge&#10;/wkbridge"></textarea>
            <p class="help-block">默认先试 <code>/bridge/conversation/sync</code>，再试 <code>/wkbridge/conversation/sync</code>。如果 OpenResty 已反代其它路径，在这里添加。</p>
          </div>

          <div class="form-group">
            <label for="conversationSyncPath">会话同步路径</label>
            <input id="conversationSyncPath" class="form-control" placeholder="/conversation/sync">
          </div>

          <div class="form-group">
            <label for="openPathPattern">打开聊天路由模板</label>
            <input id="openPathPattern" class="form-control" placeholder="/user/{slug}/chats/{roomId}">
            <p class="help-block">支持 <code>{slug}</code> 和 <code>{roomId}</code>。保持默认即可。</p>
          </div>

          <div class="row">
            <div class="col-sm-6 form-group">
              <label for="pollMs">成功轮询间隔，毫秒</label>
              <input id="pollMs" type="number" class="form-control" min="3000" max="120000" step="1000">
            </div>
            <div class="col-sm-6 form-group">
              <label for="pollErrorMs">失败重试间隔，毫秒</label>
              <input id="pollErrorMs" type="number" class="form-control" min="3000" max="60000" step="1000">
            </div>
          </div>

          <div class="checkbox">
            <label><input type="checkbox" id="debug"> 开启浏览器控制台调试</label>
          </div>

          <button id="save" class="btn btn-primary">保存设置</button>
        </div>
      </div>
    </div>
  </div>
</div>
