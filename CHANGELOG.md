# 开发记录 / Development notes

## 0.1.1

- 可在聊天面板输入口令并下载加密设备备份。备份与命令行恢复兼容。
- Download an encrypted device backup from the chat panel. The command-line restore accepts the same file format.

## 0.1.0 / First stable release

- 增加密码加密的设备备份与恢复，保留设备身份、好友、聊天记录、附件和待发队列。
- 在当前好友的本机聊天记录中搜索文字和附件名，每次检查 100 条，可继续搜索更早记录。
- 打开搜索结果时显示前后各最多 20 条消息，标出目标消息，支持返回最新消息。
- 支持引用消息回复；引用预览和未发草稿按好友分别保留，发送前由本机核对原消息。
- 搜索在内存中解密，不建立明文索引；引用作为加密文字发送，兼容旧版。

- Back up and restore the device identity, contacts, history, attachments and outbox with a passphrase.
- Search local message text and attachment names in batches of 100, with an option to scan older history.
- Open a result with up to 20 messages on each side, highlight the result, and return to the latest messages.
- Reply with a quote. Drafts and quote previews stay separate per contact; the local host verifies the original message.
- Search decrypts records in memory without a plaintext index. Quotes travel as encrypted text compatible with older clients.

## 0.0.2

2026-11-18 · 技术预览 / Technical preview

- 首次打开时显示服务连接和邀请引导，可一键启动或停止本机试用服务。
- 本机服务可随 DSH 重启，保留原设备身份和本地聊天记录。
- 支持邀请链接和本地生成的二维码，保留原邀请码的读取方式。
- 读取邀请后显示服务地址，核对指纹后才能从界面发送好友申请。
- 显示上次同步时间、送达状态和断线提示，支持立即重连并重试待发内容。

- Setup guidance with controls to start or stop a local trial relay.
- The relay can restart with DSH while keeping the device identity and local history.
- Invitation links and locally generated QR codes, with support for existing invitation codes.
- Relay address preview and fingerprint confirmation before sending a friend request.
- Last-sync time, delivery status, disconnect notices, and reconnect controls for queued messages.

## 0.0.1

首个公开预览版，提供加密聊天、材料分享和带到 DSH 新会话的功能。

First public preview with encrypted chat, material sharing, and selected context in a new DSH session.
