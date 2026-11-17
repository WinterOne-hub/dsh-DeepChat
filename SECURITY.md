# 安全说明 / Security

## 中文

消息和附件在设备端加密。中继暂存密文，能看到邮箱标识、消息大小和时间。当前协议缺少前向保密，设备私钥泄露后，持有历史密文的人可能解密旧消息。私钥保存在受文件权限保护的本机文件中。请私下交换邀请，并通过可信渠道核对设备指纹。

中继供本机或受控网络试用。跨设备时，请使用受访问控制保护的私有 HTTPS 入口。当前中继最多有 64 个邮箱，缺少注册准入、限流和邮箱回收。

发现漏洞，请通过 [GitHub 私密漏洞报告](https://github.com/WinterOne-hub/dsh-DeepChat/security/advisories/new) 提交。请提供插件版本、DSH 版本和用虚构数据复现的步骤，避免在报告中加入真实聊天、密钥、邀请或凭据。

## English

Devices encrypt messages and attachments before delivery. The relay temporarily stores ciphertext and can see mailbox IDs, message sizes, and timing. The protocol lacks forward secrecy. Someone who obtains a device private key and old ciphertext may decrypt old messages. The private key is stored in a local file protected by file permissions. Exchange invitations privately and verify fingerprints over a trusted channel.

Run the relay locally or on a trusted network. For use across devices, put it behind a private HTTPS endpoint with access controls. The relay supports up to 64 mailboxes and lacks registration controls, rate limits, and mailbox recycling.

Report vulnerabilities privately through [GitHub](https://github.com/WinterOne-hub/dsh-DeepChat/security/advisories/new). Include the plugin version, the DSH version, and steps to reproduce the issue with made-up data. Keep real chats, keys, invitations, and credentials out of the report.
