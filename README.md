# dsh-DeepChat

DeepSeek Harness 加密聊天与材料分享插件 · Encrypted chat and file sharing for DeepSeek Harness

[中文](#中文) · [English](#english) · [v0.0.1 下载 / Download](https://github.com/WinterOne-hub/dsh-DeepChat/releases/tag/v0.0.1)

| 下载 / Download | 链接 / Link |
| --- | --- |
| 安装包 / Plugin package | [dsh-DeepChat-0.0.1.tgz](https://github.com/WinterOne-hub/dsh-DeepChat/releases/download/v0.0.1/dsh-DeepChat-0.0.1.tgz) |
| 校验文件 / Checksums | [SHA256SUMS](https://github.com/WinterOne-hub/dsh-DeepChat/releases/download/v0.0.1/SHA256SUMS) |

## 中文

dsh-DeepChat 是 DeepSeek Harness 的第三方聊天插件。它在侧栏收发加密消息、文件和 DSH 回复。选中聊天内容后，可以带到 DSH 新会话继续讨论。

> 本插件基于这样一种理念：将AI引入社交应用是前AI时代的产品思维，让社交原生于大模型系统，才是AI时代的社交系统该有的模样。希望能启发更多的开发者做出符合AI时代架构的社交新产品。

### 安装

- **macOS 桌面版**。下载 Release 中的 `.tgz` 和 `SHA256SUMS`，退出 DSH，在下载目录运行下面的命令，再重新打开 DSH。从侧栏打开 **dsh-DeepChat**。原「私聊分享」用户可按同一方式安装，继续使用本机的设备身份和聊天数据。
- **DSH Web**。在源码目录用 Node.js 24 运行下面的构建命令。
- 已验证 DSH Desktop 0.2.2-rc.3（macOS）和 DSH Web 0.2.0-rc.2。Windows 和 Linux 桌面版待验证。

### 连接和使用

在源码目录运行 `npm ci` 和 `node src/serve.js`，中继默认监听 `127.0.0.1:8611`。在插件的「投递设置」中填入地址，点击「保存并注册」。跨设备时，双方需要连接同一个私有 HTTPS 中继，并通过可信渠道交换邀请、核对设备指纹。

聊天时可以分享一条已完成的 DSH 回复和一个文件，文件上限为 128 KiB。可以划选一段文字或勾选最多 10 条消息，再点「带到 DSH 新会话」。附件单独勾选，内容先进入草稿，用户点击发送后才交给所选模型服务。DeepSeek 账号的昵称和头像可导入本机显示，好友身份仍由设备指纹确认。

### 在 DSH 中发现

支持自定义插件索引的 DSH 版本可在「插件」中启用实验性的「自定义插件索引」，再到「发现」中添加下方地址，搜索 `dsh-DeepChat`、`聊天` 或 `DeepSeek`。

```text
https://raw.githubusercontent.com/WinterOne-hub/dsh-DeepChat/main/market-index.json
```

安装确认中会显示源仓库和固定提交。启用前请核对来源。这个索引只列出本项目。

### 问题和建议

安装遇到问题或想提功能建议，可以[提交 Issue](https://github.com/WinterOne-hub/dsh-DeepChat/issues)。请写明 DSH 版本和操作系统。后续版本会发布在 [Releases](https://github.com/WinterOne-hub/dsh-DeepChat/releases)。

### 安全边界

这是供本机或受控网络试用的技术预览。聊天记录保存在本机，中继临时存放密文，能看到邮箱标识、消息大小和时间。当前协议缺少前向保密，设备私钥泄露后，持有历史密文的人可能解密旧消息。请限制中继访问范围。[安全说明与漏洞报告](SECURITY.md)

## English

dsh-DeepChat is a third-party chat plugin for DeepSeek Harness. Send encrypted messages, files, and DSH replies from the sidebar. Select a chat excerpt and open it in a new DSH session to discuss it with the model.

> This plugin is built on the idea that adding AI to a social app reflects pre-AI product thinking. Social interaction should be native to large language model systems. We hope this inspires more developers to build social products around an architecture designed for the AI era.

### Install

- **macOS desktop.** Download the `.tgz` and `SHA256SUMS` from the release. Quit DSH, run the desktop commands below from the download directory, then reopen DSH and select **dsh-DeepChat** in the sidebar. If you used the local preview, the same commands keep your device identity and chat data.
- **DSH Web.** Use Node.js 24 and run the build commands below from the source directory.
- Tested on DSH Desktop 0.2.2-rc.3 for macOS and DSH Web 0.2.0-rc.2. The Windows and Linux desktop builds have yet to be tested.

### Connect and use

Run `npm ci` and `node src/serve.js` from the source directory. The relay listens on `127.0.0.1:8611` by default. Enter its address in the plugin's relay settings and register your device. To chat across devices, connect both to the same private HTTPS relay, exchange invitations over a trusted channel, and check device fingerprints.

You can share a completed DSH reply with one file of up to 128 KiB. Select text or up to 10 messages to open a new DSH draft. Attachments are optional. The selected model service receives the content when you send the draft. You can import a DeepSeek name and avatar for display on your device. Device fingerprints verify contacts.

### Find it in DSH

On DSH versions that support custom plugin indexes, enable the experimental **Custom plugin indexes** bundle on the Plugins page. In **Discover**, add the URL below and search for `dsh-DeepChat`, `chat`, or `DeepSeek`.

```text
https://raw.githubusercontent.com/WinterOne-hub/dsh-DeepChat/main/market-index.json
```

The install confirmation shows the repository and a pinned commit. Check the source before installing. This index lists this project only.

### Questions and feedback

[Open an issue](https://github.com/WinterOne-hub/dsh-DeepChat/issues) for installation help or feature requests. Include your DSH version and operating system. Future versions will appear under [Releases](https://github.com/WinterOne-hub/dsh-DeepChat/releases).

### Security

This technical preview is for local use or trusted networks. Chat history stays on the device. The relay temporarily stores ciphertext and can see mailbox IDs, message sizes, and timing. The protocol lacks forward secrecy, so someone who obtains the device private key and old ciphertext may decrypt old messages. Restrict access to the relay. [Security and vulnerability reporting](SECURITY.md)

## 安装命令 / Install commands

**macOS Desktop**

```sh
shasum -a 256 -c SHA256SUMS
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD/dsh-DeepChat-0.0.1.tgz" --offline
```

**DSH Web**

```sh
npm ci
npm test
archive=$(npm pack --silent)
dsh plugin --profile web add "$PWD/$archive" --offline
```

[MIT License](LICENSE)
