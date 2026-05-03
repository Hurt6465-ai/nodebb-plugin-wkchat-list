nodebb-plugin-wkchat-list

将 WKChat 19.10.6-wk-data-nbb-open 打包为 NodeBB 插件。

功能说明

· 替换 [component="chat/nav-wrapper"] 内的 NodeBB 聊天会话列表。
· 通过悟空桥的 POST /conversation/sync 加载会话。
· 不请求 /token，也不注册或连接 WK WebSocket。
· 点击会话后会打开 /user/{slug}/chats/{roomId}，这样你现有的消息窗口插件就能处理聊天室。
· 点击时在本地清除未读记录，并将已读标记持久化存储到 localStorage 中。

在 Docker NodeBB 中安全安装

```bash
docker update --restart=no nodebb

docker exec -it nodebb sh -lc 'cd /usr/src/app && npm install --legacy-peer-deps --force https://github.com/Hurt6465-ai/nodebb-plugin-wkchat-list/archive/refs/heads/main.tar.gz && ./nodebb build'

docker restart nodebb
```

确认论坛运行正常后：

```bash
docker update --restart=always nodebb
```

ACP 设置

ACP -> 插件 -> WKChat List

默认桥接基路径：

```text
/bridge
/wkbridge
```

默认同步路径：

```text
/conversation/sync
```

浏览器调试

```js
WKChat.debugNow()
window.__wkChatListPluginVersion
```
