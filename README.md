# dsh-DeepChat

DeepSeek Harness 加密聊天与材料分享插件 · Encrypted chat and file sharing for DeepSeek Harness

[中文](#中文) · [English](#english) · [v0.1.1 下载 / Download](https://github.com/WinterOne-hub/dsh-DeepChat/releases/tag/v0.1.1)

| 下载 / Download | 链接 / Link |
| --- | --- |
| 安装包 / Plugin package | [dsh-DeepChat-0.1.1.tgz](https://github.com/WinterOne-hub/dsh-DeepChat/releases/download/v0.1.1/dsh-DeepChat-0.1.1.tgz) |
| 校验文件 / Checksums | [SHA256SUMS](https://github.com/WinterOne-hub/dsh-DeepChat/releases/download/v0.1.1/SHA256SUMS) |
| 源码 / Source code | [v0.1.1 ZIP](https://github.com/WinterOne-hub/dsh-DeepChat/archive/refs/tags/v0.1.1.zip) |

## 中文

dsh-DeepChat 是 DeepSeek Harness 的第三方聊天插件。它在侧栏收发加密消息、文件和 DSH 回复。选中聊天内容后，可以带到 DSH 新会话继续讨论。

> 本插件基于这样一种理念：将AI引入社交应用是前AI时代的产品思维，让社交原生于大模型系统，才是AI时代的社交系统该有的模样。希望能启发更多的开发者做出符合AI时代架构的社交新产品。

### 安装

- **macOS 桌面版**。下载 Release 中的 `.tgz` 和 `SHA256SUMS`，退出 DSH，在下载目录运行下面的命令，再重新打开 DSH。从侧栏打开 **dsh-DeepChat**。原「私聊分享」用户可按同一方式安装，继续使用本机的设备身份和聊天数据。
- **DSH Web**。在源码目录用 Node.js 24 运行下面的构建命令。
- 已验证 DSH Desktop 0.2.2-rc.3（macOS）和 DSH Web 0.2.0-rc.2。Windows 和 Linux 桌面版待验证。

### 连接和使用

可点「一键开始本机试用」，插件会启动本地服务并注册设备。服务只监听本机，随 DSH 启动和退出，也可以在设置中停止。跨电脑聊天需要双方使用同一个私有 HTTPS 服务。邀请链接或二维码可私下交换，接收方把链接粘贴到「添加好友」，读取后核对设备指纹再发送申请。打开链接会显示项目页面，添加好友在插件中完成。

使用 0.0.1，或需要单独运行中继时，在源码目录运行 `npm ci` 和 `node src/serve.js`，中继默认监听 `127.0.0.1:8611`。在插件的「投递设置」中填入地址，点击「保存并注册」。跨设备时，双方需要连接同一个私有 HTTPS 中继，并通过可信渠道交换邀请、核对设备指纹。

聊天时可以分享一条已完成的 DSH 回复和一个文件，文件上限为 128 KiB。可以划选一段文字或勾选最多 10 条消息，再点「带到 DSH 新会话」。附件单独勾选，内容先进入草稿，用户点击发送后才交给所选模型服务。DeepSeek 账号的昵称和头像可导入本机显示，好友身份仍由设备指纹确认。

### 搜索和引用回复

聊天框顶部新增「搜索聊天」，可查找当前好友的文字和附件名。每次检查 100 条本机记录，点击「继续搜索更早记录」可扩大范围。点结果查看前后文，点「返回最新消息」恢复聊天。搜索不会读取附件正文，也不会把关键词发给中继或模型。

消息下方的「引用回复」会在输入框上方预览原文，最多引用 600 字。发送后以文字引用显示，兼容 0.0.2。取消引用不影响已写的回复，切换好友会保留各自的草稿和引用。引用和回复合计仍受 8192 字节限制。

### 备份与恢复

从聊天面板点「加密备份」，输入两次口令后下载 `.deepchat` 文件。聊天数据库最多 16 MiB。下载文件可以用下方命令恢复。

退出 DSH 后，可用 Node.js 24 从源码目录运行 `npm ci`，再按下方命令备份。备份包含设备私钥、好友、历史、附件和待发消息，使用口令加密。设备数据库上限为 128 MiB。恢复到新目录后，将 `DSH_CHAT_DEVICE` 指向该目录启动 DSH，重新设置投递地址并注册。中继队列、投递设置和个人资料需单独保留。迁移后只在一处使用恢复的设备身份。

### 在 DSH 中发现

支持自定义插件索引的 DSH 版本可在「插件」中启用实验性的「自定义插件索引」，再到「发现」中添加下方地址，搜索 `dsh-DeepChat`、`聊天` 或 `DeepSeek`。

```text
https://raw.githubusercontent.com/WinterOne-hub/dsh-DeepChat/main/market-index.json
```

安装确认中会显示源仓库和固定提交。启用前请核对来源。这个索引只列出本项目。

### 问题和建议

安装遇到问题或想提功能建议，可以[提交 Issue](https://github.com/WinterOne-hub/dsh-DeepChat/issues)。请写明 DSH 版本和操作系统。后续版本会发布在 [Releases](https://github.com/WinterOne-hub/dsh-DeepChat/releases)。

### 安全边界

本版用于本机和受控网络。聊天记录保存在本机，中继临时存放密文，能看到邮箱标识、消息大小和时间。当前协议缺少前向保密，设备私钥泄露后，持有历史密文的人可能解密旧消息。请限制中继访问范围。[安全说明与漏洞报告](SECURITY.md)

## English

dsh-DeepChat is a third-party chat plugin for DeepSeek Harness. Send encrypted messages, files, and DSH replies from the sidebar. Select a chat excerpt and open it in a new DSH session to discuss it with the model.

> This plugin is built on the idea that adding AI to a social app reflects pre-AI product thinking. Social interaction should be native to large language model systems. We hope this inspires more developers to build social products around an architecture designed for the AI era.

### Install

- **macOS desktop.** Download the `.tgz` and `SHA256SUMS` from the release. Quit DSH, run the desktop commands below from the download directory, then reopen DSH and select **dsh-DeepChat** in the sidebar. If you used the local preview, the same commands keep your device identity and chat data.
- **DSH Web.** Use Node.js 24 and run the build commands below from the source directory.
- Tested on DSH Desktop 0.2.2-rc.3 for macOS and DSH Web 0.2.0-rc.2. The Windows and Linux desktop builds have yet to be tested.

### Connect and use

The setup screen can start a local relay and register the device. The relay listens on loopback only, starts and stops with DSH, and can be stopped in settings. To chat across computers, both users need the same private HTTPS relay. Exchange invitation links or QR codes privately. Paste the link into the plugin, check the device fingerprint over a trusted channel, and send a friend request. Opening the link shows the project page; adding a contact happens inside the plugin.

On 0.0.1, or to run a standalone relay, run `npm ci` and `node src/serve.js` from the source directory. The relay listens on `127.0.0.1:8611` by default. Enter its address in the plugin's relay settings and register your device. To chat across devices, connect both to the same private HTTPS relay, exchange invitations over a trusted channel, and check device fingerprints.

You can share a completed DSH reply with one file of up to 128 KiB. Select text or up to 10 messages to open a new DSH draft. Attachments are optional. The selected model service receives the content when you send the draft. You can import a DeepSeek name and avatar for display on your device. Device fingerprints verify contacts.

### Search and quote replies

Use **搜索聊天** (Search chat) above a conversation to find local text or attachment names. Each request checks 100 records; continue with **继续搜索更早记录** to scan older history. Open a result to see nearby messages, then choose **返回最新消息** to return. Search does not read attachment bodies or send keywords to the relay or model.

Choose **引用回复** (Reply with quote) under a message to preview up to 600 characters above the composer. Quotes are sent as text and work with 0.0.2. Cancelling a quote keeps your reply. Switching contacts keeps each contact's draft and quote. The combined quote and reply must fit within 8192 UTF-8 bytes.

### Backup and restore

Choose **加密备份** (Encrypted backup) in the chat panel, then enter your passphrase twice to download a `.deepchat` file. The panel supports chat databases up to 16 MiB. Use the restore command below with the downloaded file.

Quit DSH. With Node.js 24, run `npm ci` in the source directory, then use the commands below. The passphrase encrypts the device keys, contacts, history, attachments and outbox. The backup supports a device database of up to 128 MiB. Restore to a new directory, start DSH with `DSH_CHAT_DEVICE` set to that directory, then set the relay address and register. Relay queues, relay settings and profiles are separate. After migration, use the restored identity on one active device only.

### Find it in DSH

On DSH versions that support custom plugin indexes, enable the experimental **Custom plugin indexes** bundle on the Plugins page. In **Discover**, add the URL below and search for `dsh-DeepChat`, `chat`, or `DeepSeek`.

```text
https://raw.githubusercontent.com/WinterOne-hub/dsh-DeepChat/main/market-index.json
```

The install confirmation shows the repository and a pinned commit. Check the source before installing. This index lists this project only.

### Questions and feedback

[Open an issue](https://github.com/WinterOne-hub/dsh-DeepChat/issues) for installation help or feature requests. Include your DSH version and operating system. Future versions will appear under [Releases](https://github.com/WinterOne-hub/dsh-DeepChat/releases).

### Security

This release is intended for local use and private networks. Chat history stays on the device. The relay temporarily stores ciphertext and can see mailbox IDs, message sizes, and timing. The protocol lacks forward secrecy, so someone who obtains the device private key and old ciphertext may decrypt old messages. Restrict access to the relay. [Security and vulnerability reporting](SECURITY.md)

## 安装命令 / Install commands

**macOS Desktop**

```sh
shasum -a 256 -c SHA256SUMS
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD/dsh-DeepChat-0.1.1.tgz" --offline
```

**DSH Web**

```sh
npm ci
npm test
archive=$(npm pack --silent)
dsh plugin --profile web add "$PWD/$archive" --offline
```

**加密备份 / Encrypted backup (Bash or Zsh)**

```sh
printf 'Backup passphrase: '
IFS= read -rs backup_passphrase
printf '\n'
printf '%s' "$backup_passphrase" | node src/cli.js \
  "$HOME/.dsh/private-chat" backup "$PWD/device.deepchat"
printf '%s' "$backup_passphrase" | node src/cli.js \
  "$HOME/.dsh/private-chat-restored" restore "$PWD/device.deepchat"
unset backup_passphrase
```

替换为实际数据目录。恢复目录必须不存在。使用独立长口令，并妥善保管。
Use the actual device directory. The restore directory must be new. Use a separate, long passphrase and keep it safe.

[开发记录 / Development notes](CHANGELOG.md) · [MIT License](LICENSE)
