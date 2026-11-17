# dsh-DeepChat

兼容 DeepSeek Harness 的第三方聊天插件。你可以在侧栏添加好友、收发加密消息和材料，也可以把别人分享的内容带进 DSH 新会话，接着和模型讨论。

> 本插件基于这样一种理念：将AI引入社交应用是前AI时代的产品思维，让社交原生于大模型系统，才是AI时代的社交系统该有的模样。希望能启发更多的开发者做出符合AI时代架构的社交新产品。

[下载技术预览版](https://github.com/WinterOne-hub/dsh-DeepChat/releases/tag/v0.0.1) · [安全边界与漏洞报告](SECURITY.md) · [MIT 许可证](LICENSE)

当前版本适合本机或受控网络自托管。消息在设备端加密，离线时由中继暂存密文。当前协议使用长期设备密钥，缺少前向保密，接收私钥泄露可能使历史密文被解读。选中的聊天内容和附件先进入 DSH 的可编辑草稿，只有你主动发送时，才会交给所选模型服务。

## 安装到 DSH Desktop（macOS）

已在 DSH Desktop 0.2.2-rc.3 上验证。下载 Release 的 `.tgz` 和 `SHA256SUMS`，进入下载目录运行 `shasum -a 256 -c SHA256SUMS`。完全退出 DeepSeek Harness 后，在同一目录执行以下命令，再重新打开 Desktop。Desktop 和 Web 使用各自的插件配置。

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD/dsh-DeepChat-0.0.1.tgz" --offline
```

在侧栏寻找「dsh-DeepChat」。若入口收在「更多」里，可以从那里打开并固定到侧栏。打开面板后，标题旁会显示版本号。原「私聊分享」用户可按同一命令安装，继续使用本机的设备身份和聊天数据。公开版本号从 0.0.1 开始。

## 安装到本机 DSH Web

已验证 `dsh 0.2.0-rc.2`。可用 Release 的安装包，或在本目录运行以下命令自行打包。安装包包含加密依赖，支持离线安装。

```sh
npm ci
npm test
archive=$(npm pack --silent)
dsh plugin --profile web add "$PWD/$archive" --offline
```

本机试用可在源码目录运行 `node src/serve.js`。投递服务默认监听 `127.0.0.1:8611`。跨设备使用时，把两端设置为同一个私有 HTTPS 投递服务，并在代理或网络层将访问限制给试用成员。

1. 从侧栏打开「dsh-DeepChat → 投递设置」，填写服务地址。可先测试连接，再按「保存并注册」。设置保存在本机。
2. 打开「好友」并显示邀请。接收方私下把邀请发给申请方。申请方核对指纹、填写备注名，再发好友申请。接收方核对申请方指纹后接受或拒绝。好友申请有效期为 24 小时，两端均可使用本版。
3. 选择一个好友会话并发送文字，或在输入框旁打开「分享材料」。选一条已完成的 DSH 回复和一个本地文件。单文件上限为 128 KiB。核对预览中的收件人、回复、文件名、大小和 SHA-256 后发送。
4. 打开插件面板时立即同步。应用运行期间，每 10 秒自动同步消息和好友申请。侧栏数字包含未读消息和待处理的好友申请。在前台打开某个会话会在本机标记该会话为已读。收到的附件可另存。可以随时手动同步或重试投递。

分享时只提取选中回复的文本字段。预览固定文件字节，收件端校验材料包和附件后才入库。

聊天框左侧是好友列表，右侧显示所选好友的本地对话和输入框。「查看更早消息」可继续读取历史。即使投递服务暂时不可用，也可以继续查看本机已有的好友和对话记录。

- 「个人资料 → 使用 DeepSeek 资料」可以预览并采用当前 DSH 账号的昵称和头像。也可以手动填写昵称。导入用于本机聊天资料，好友继续通过邀请和设备指纹验证。
- 可以在好友列表中搜索名称、切换到「未读」，也可以在对话中展开材料卡，查看回复并保存附件。
- 在一条消息里划选文字，或点「选择消息」勾选最多十条消息，再点「带到 DSH 新会话」。如果选择了材料，可另行勾选其附件。DSH 会在当前工作区打开新会话并预填草稿，你可以提问、修改或发送。若当前有多个工作区，请先打开要用的 DSH 工作区。

切换投递服务时，原服务的待发队列留在原服务对应的本机记录里。有效期内切回原服务即可重试。连接测试使用公共协议探测请求，注册操作使用该设备的邮箱凭据。

## 用两个 CLI 试跑

需要 Node.js 24。在第一个终端启动投递服务。

```sh
node src/serve.js
```

在第二个终端创建两台模拟设备。分别记录输出中的 `code` 和 `fingerprint`。首次注册失败时，服务恢复后可用 `register` 重试。

```sh
node src/cli.js .state/alice init
node src/cli.js .state/bob init
```

把对应设备输出的值填入 `ALICE_CODE`、`ALICE_FINGERPRINT`、`BOB_CODE` 和 `BOB_FINGERPRINT`。实际跨设备交换时，通过可信渠道核对指纹，并私下交换邀请。邀请包含向该设备投递密文所需的写入凭据。

```sh
printf '%s' "$BOB_CODE" | node src/cli.js .state/alice trust bob "$BOB_FINGERPRINT"
printf '%s' "$ALICE_CODE" | node src/cli.js .state/bob trust alice "$ALICE_FINGERPRINT"
printf '%s' '你好，这是离线消息。' | node src/cli.js .state/alice send bob
```

看到 `stored` 后，可以关闭发送端。可以在此时重启投递服务，再运行以下命令模拟收件和查看回执。

```sh
node src/cli.js .state/bob sync
node src/cli.js .state/bob history
node src/cli.js .state/alice sync
node src/cli.js .state/alice history
```

`queued` 表示待重试，`stored` 表示中转节点确认持久化，`delivered` 表示已验证收件端回执。每条密文到期后从队列移除，当前保留期为 24 小时。`expired-unconfirmed` 表示到期时仍未收到回执。远端读取收件箱需要设备独有的凭据。

若 CLI 收到材料包，从 `history` 取得消息 ID，再用 `node src/cli.js .state/bob save 消息ID 本地目标路径` 保存已校验的附件。

## 原型边界

- 消息用 `jose` 实现 Ed25519 JWS 签名和 X25519 ECDH-ES / AES-256-GCM JWE 加密。收件端验证已配对身份及信封绑定。当前使用静态设备密钥，接收私钥泄露时，持有历史密文的一方可能解密旧消息。后续需要验证带前向保密的异步会话协议。 [JOSE 实现](https://github.com/panva/jose) · [Signal 异步会话规范](https://signal.org/docs/specifications/sesame/)
- 客户端 SQLite 保存密文，私钥目前保存在权限为 `0600` 的设备目录文件中。系统钥匙串接入留待后续。投递服务可观察邮箱标识、流量大小和在线时机。
- 服务面向本机和受控网络测试。它允许访问者自行注册，单个中继最多有 64 个邮箱，当前没有注册准入、限流或邮箱回收机制。请把中继限制在可信网络内。跨设备可在中继前配置私有 HTTPS 入口，并将两端的 `DSH_CHAT_RELAY` 指向该 HTTPS 源。
- 侧栏和分享路由面向本机 DSH，使用 DSH 的登录验证。在线直连、系统钥匙串和手机通知属于后续工作。
