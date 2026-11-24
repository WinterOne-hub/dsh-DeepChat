window.__ModuleLoader__.load({
  id: 'dsh-private-chat-prototype',
  factory(require) {
    const { cloneElement, createElement: h, useEffect, useRef, useState } = require('react')
    const panel = 'dsh-private-chat'
    const displayName = 'dsh-DeepChat'
    const statusLabels = { received: '已接收', delivered: '对方设备已接收', stored: '已发送，等待对方设备', queued: '待发送，将自动重试',
      'expired-unconfirmed': '已过期，未确认送达' }
    const requestLabels = { pending: '等待对方确认', accepted: '已成为好友', rejected: '已拒绝', expired: '已过期' }
    const timeLabel = time => new Date(time).toLocaleString(undefined, {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
    const dayKey = time => new Date(time).toDateString()
    const dayLabel = time => {
      if (dayKey(time) === dayKey(Date.now())) return '今天'
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return dayKey(time) === dayKey(yesterday) ? '昨天' : new Date(time).toLocaleDateString()
    }
    const styles = `
      .private-chat { --edge: var(--dsw-alias-border-l3, #7d7d7d50); --soft: color-mix(in srgb, currentColor 6%, transparent);
        --selected: color-mix(in srgb, #5377df 16%, transparent); --bubble: color-mix(in srgb, #5274dd 18%, transparent);
        height: 100%; overflow: auto; box-sizing: border-box; padding: clamp(12px, 2.3vw, 32px); container-type: inline-size; }
      .private-chat > div { max-width: 1200px; min-height: 100%; margin: auto; display: flex; flex-direction: column; gap: 12px; }
      .private-chat h1, .private-chat h2, .private-chat p { margin: 0; }
      .private-chat h1 { font-size: 22px; }
      .private-chat h2 { font-size: 16px; }
      .private-chat small { font-size: 12px; }
      .private-chat .row { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }
      .private-chat .top, .private-chat .spread { justify-content: space-between; }
      .private-chat .card { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--edge); border-radius: 11px; min-width: 0; }
      .private-chat label, .private-chat .rows { display: grid; gap: 6px; min-width: 0; }
      .private-chat input, .private-chat select, .private-chat textarea, .private-chat button {
        font: inherit; color: inherit; max-width: 100%; box-sizing: border-box; padding: 7px 9px;
        border-radius: 7px; border: 1px solid var(--edge); background: inherit; }
      .private-chat input:not([type=checkbox]), .private-chat select, .private-chat textarea { width: 100%; }
      .private-chat button { cursor: pointer; justify-self: start; }
      .private-chat button:disabled { opacity: .48; cursor: default; }
      .private-chat button:hover:not(:disabled) { background: var(--soft); }
      .private-chat button.primary, .private-chat button.primary:hover:not(:disabled) { color: white; background: #355dcc; border-color: #355dcc; }
      .private-chat button:focus-visible, .private-chat input:focus-visible, .private-chat textarea:focus-visible, .private-chat select:focus-visible {
        outline: 2px solid #5377df; outline-offset: 2px; }
      .private-chat .workspace { display: grid; grid-template-columns: minmax(186px, 30%) minmax(0, 1fr); flex: 1;
        border: 1px solid var(--edge); border-radius: 13px; min-height: 390px; overflow: clip; }
      .private-chat .threads { max-height: min(80vh, 840px); overflow: auto; align-content: start; min-width: 0;
        padding: 12px 9px; display: grid; gap: 6px; border-right: 1px solid var(--edge); background: var(--soft); }
      .private-chat .roster-heading { padding: 0 4px; }
      .private-chat .chat-pane { display: grid; min-width: 0; grid-template-rows: auto minmax(134px,1fr) auto; min-height: 390px; }
      .private-chat .chat-header { border-bottom: 1px solid var(--edge); padding: 10px 13px; }
      .private-chat .composer { border-top: 1px solid var(--edge); padding: 11px 13px; align-content: start; }
      .private-chat .muted { opacity: .76; }
      .private-chat .thread { width: 100%; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center;
        gap: 8px; text-align: left; padding: 8px 6px; border-color: transparent; border-radius: 10px; }
      .private-chat .thread[aria-current=true], .private-chat .filter[aria-pressed=true] { background: var(--selected); border-color: transparent; }
      .private-chat .filter, .private-chat .quiet { border-color: transparent; }
      .private-chat .avatar { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; overflow: hidden;
        flex: none; font-weight: 600; background: var(--selected); color: inherit; }
      .private-chat .avatar img { width: 100%; height: 100%; object-fit: cover; }
      .private-chat .preview { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .78; }
      .private-chat .unread-count { align-self: end; justify-self: end; padding: 1px 6px; background: #355dcc; color: white; border-radius: 10px; }
      .private-chat .history { display: grid; gap: 9px; align-content: start; max-height: 63vh; min-height: 134px; overflow: auto; padding: 10px 14px; }
      .private-chat .day { justify-self: center; border-radius: 9px; padding: 3px 8px; background: var(--soft); }
      .private-chat .message { max-width: min(94%, 640px); justify-self: start; background: var(--soft); padding: 8px 10px; border-radius: 12px; }
      .private-chat .message.out { justify-self: end; background: var(--bubble); }
      .private-chat .message[data-focus=true] { box-shadow: 0 0 0 3px #c18a28; }
      .private-chat .search-results { max-height: 240px; overflow: auto; }
      .private-chat .search-result { width: 100%; text-align: left; display: grid; gap: 4px; }
      .private-chat .search-result pre { max-height: 72px; overflow: hidden; }
      .private-chat .quote-preview { border-left: 3px solid #5377df; padding: 6px 10px; background: var(--soft); }
      .private-chat .quote-preview pre { max-height: 78px; overflow: auto; }
      .private-chat .message[data-selected=true] { outline: 2px solid #5377df; outline-offset: 1px; }
      .private-chat .message-meta { justify-self: end; opacity: .76; }
      .private-chat .message-select { display: flex; align-items:center; gap: 6px; }
      .private-chat pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
      .private-chat .material { max-width: min(100%, 320px); border-radius: 8px; padding: 6px 8px; background: var(--soft); }
      .private-chat .material summary { cursor: pointer; }
      .private-chat .material strong, .private-chat .material small { display:block; }
      .private-chat .material .rows { padding-top: 8px; }
      .private-chat .context-actions { background: var(--selected); border-radius: 8px; padding: 8px; }
      .private-chat .invite-qr { width: min(100%, 264px); height: auto; image-rendering: pixelated; background: white; }
      .private-chat .security-code { overflow-wrap: anywhere; user-select: all; }
      .private-chat .material-preview { max-height: 200px; overflow: auto; }
      .private-chat output, .private-chat p, .private-chat strong, .private-chat small { overflow-wrap: anywhere; }
      .private-chat output:empty { display: none; }
      @container (max-width: 575px) {
        .private-chat .workspace { grid-template-columns: minmax(0, 1fr); }
        .private-chat .threads { max-height: 205px; border-right: 0; border-bottom: 1px solid var(--edge); }
        .private-chat .history { max-height: 46vh; }
      }
    `

    async function api(action, { input, id, before, binary = false } = {}) {
      const url = new URL(input ? 'api/private-chat/submit' : 'api/private-chat', document.baseURI)
      url.searchParams.set('action', action)
      if (id) url.searchParams.set('id', id)
      if (before) url.searchParams.set('before', String(before))
      const init = { headers: { 'X-DSH-Private-Chat': '1' }, cache: 'no-store' }
      if (input) {
        init.method = 'POST'
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify({ action, ...input })
      }
      const response = await fetch(url, init)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? `DSH 请求失败（${response.status}）`)
      }
      return binary ? response.blob() : response.json()
    }

    const subscribers = new Set()
    let overview, fetchingOverview, timer
    function refreshOverview() {
      if (fetchingOverview) return fetchingOverview
      fetchingOverview = api('overview').then(data => {
        overview = { data }
        for (const notify of subscribers) notify(overview)
      }, error => {
        overview = { data: overview?.data, error: error.message }
        for (const notify of subscribers) notify(overview)
      }).finally(() => { fetchingOverview = undefined })
      return fetchingOverview
    }

    function useOverview() {
      const [state, setState] = useState(overview)
      useEffect(() => {
        subscribers.add(setState)
        if (!timer) timer = setInterval(refreshOverview, 3000)
        void refreshOverview()
        return () => {
          subscribers.delete(setState)
          if (!subscribers.size) {
            clearInterval(timer)
            timer = undefined
          }
        }
      }, [])
      return state
    }

    function encodeFile(bytes) {
      let binary = ''
      for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
      }
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    }

    function downloadBlob(file, filename) {
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    async function getFile(item) {
      const file = await api('download', { id: item.id, binary: true })
      downloadBlob(file, item.file.name)
    }

    const label = (title, control) => h('label', null, title, cloneElement(control, { 'aria-label': title }))
    const option = (value, title) => h('option', { value, key: value }, title)
    const button = (title, onClick, disabled = false, primary = false) => h('button', {
      type: 'button', className: primary ? 'primary' : undefined, disabled, onClick
    }, title)

    function Avatar({ name, url }) {
      const [failed, setFailed] = useState('')
      return h('span', { className: 'avatar', 'aria-hidden': true }, url && failed !== url
        ? h('img', { src: url, alt: '', referrerPolicy: 'no-referrer', onError: () => setFailed(url) })
        : Array.from(name || '我')[0])
    }

    const clientMetadata = () => ({ locale: navigator.language, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })

    function BackupPanel({ busy, run }) {
      const [password, setPassword] = useState('')
      const [confirmation, setConfirmation] = useState('')
      const longEnough = Array.from(password).length >= 12
      const matches = password === confirmation

      function submit(event) {
        event.preventDefault()
        if (busy || !longEnough || !matches) return
        void run(async () => {
          const pending = api('export-backup', { input: { password }, binary: true })
          setPassword('')
          setConfirmation('')
          const file = await pending
          const date = new Date().toISOString().slice(0, 10)
          downloadBlob(file, `dsh-DeepChat-${date}.deepchat`)
          return '已发起加密备份下载'
        })
      }

      return h('form', { className: 'card', 'aria-label': '加密备份', onSubmit: submit },
        h('h2', null, '导出加密备份'),
        h('p', null, '备份包含设备身份、好友、历史、附件和待发消息。聊天数据库超过 16 MiB 时，请用命令行备份。'),
        h('small', { className: 'muted' }, '口令至少 12 个字符。恢复时需要同一个口令，请单独保管。'),
        label('备份口令', h('input', { type: 'password', value: password, autoComplete: 'new-password', maxLength: 256, disabled: busy,
          onChange: event => setPassword(event.target.value) })),
        label('再次输入备份口令', h('input', { type: 'password', value: confirmation, autoComplete: 'new-password', maxLength: 256, disabled: busy,
          onChange: event => setConfirmation(event.target.value) })),
        confirmation && !matches && h('small', { role: 'status' }, '两次口令不一致'),
        h('button', { type: 'submit', className: 'primary', disabled: busy || !longEnough || !matches }, '下载加密备份'))
    }

    function ProfilePanel({ profile, disabled, run }) {
      const [name, setName] = useState(profile?.name ?? '')
      const [preview, setPreview] = useState(null)
      return h('section', { className: 'card', 'aria-label': '聊天个人资料' },
        h('h2', null, '聊天个人资料'),
        h('div', { className: 'row' }, h(Avatar, { name: profile?.name, url: profile?.avatarUrl }),
          h('span', null, profile?.name || '本机用户'), profile?.source === 'deepseek' && h('small', { className: 'muted' }, 'DeepSeek 资料')),
        label('聊天昵称', h('input', { value: name, maxLength: 64, disabled, onChange: event => setName(event.target.value) })),
        h('div', { className: 'row' }, button('保存昵称', () => run(async () => {
          await api('save-manual-profile', { input: { name } })
          setPreview(null)
          return '已保存聊天昵称'
        }), disabled || !name.trim()), button('使用 DeepSeek 资料', () => run(async () => {
          setPreview(await api('preview-account-profile', { input: { client: clientMetadata() } }))
        }), disabled)),
        preview && h('div', { className: 'rows context-actions', 'aria-label': 'DeepSeek 资料预览' },
          h('div', { className: 'row' }, h(Avatar, { name: preview.name, url: preview.avatarUrl }),
            h('strong', null, preview.name || 'DeepSeek 头像')),
          h('div', { className: 'row' }, button('采用资料', () => run(async () => {
            const saved = await api('save-account-profile', { input: { ticket: preview.ticket, client: clientMetadata() } })
            setName(saved.name)
            setPreview(null)
            return '已采用 DeepSeek 资料'
          }), disabled, true), button('取消', () => setPreview(null), disabled))))
    }

    async function openHarnessDraft(ctx, { prompt, files }, current) {
      const workspaces = ctx.workspaces.list.getSnapshot().items
      const target = workspaces.find(item => item.sessionIds.includes(current)) ?? (workspaces.length === 1 ? workspaces[0] : null)
      if (!target && workspaces.length > 1) throw new Error('请先在 DSH 打开要用于讨论的工作区')
      const navigation = ctx.layout.beginNavigation()
      const workspace = target ?? await ctx.workspaces.initializeDefault?.(navigation)
      navigation.throwIfAborted()
      const sessionId = await ctx.sessions.create({ workspaceId: workspace?.workspaceId, sessionId: `session-${crypto.randomUUID()}` })
      navigation.throwIfAborted()
      const reference = ctx.sessions.retain(sessionId, { source: 'privateChatDraft', signal: navigation })
      let drafts = []
      let opened = false
      try {
        const binding = await reference.ready
        navigation.throwIfAborted()
        const conversation = ctx.conversation
        const input = conversation.input.for(binding.ctx)
        if (typeof conversation.input.requestDraftInitialization === 'function') {
          const outcome = conversation.input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'keep' })
          if (outcome !== 'applied') throw new Error('DSH 未能写入新会话草稿')
        } else {
          if (input.state.getSnapshot().draft) throw new Error('目标会话已有草稿')
          input.setDraft(prompt)
        }
        if (files.length) {
          drafts = conversation.createDrafts(sessionId, files.map(file => {
            const bytes = Uint8Array.from(atob(file.data.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
            return new File([bytes], file.name, { type: 'application/octet-stream' })
          }), false)
          if (!input.addAttachments(drafts.map(file => file.id))) throw new Error('DSH 未能添加所选附件')
        }
        ctx.uiWorkspace.openSession(sessionId)
        opened = true
      } finally {
        if (!opened && drafts.length) ctx.conversation.releaseDraftAttachments(drafts)
        reference.release()
      }
    }

    function ChatMessage({ item, selecting, selected, disabled, toggle, synchronize, run, relay, quote, focused }) {
      const body = h('pre', { 'data-chat-message-text': item.id }, item.text)
      return h('article', { className: `rows message ${item.direction}`, 'data-selected': selected || undefined,
        'data-focus': focused || undefined, 'data-message-id': item.id },
        selecting && h('label', { className: 'message-select' }, h('input', { type: 'checkbox', checked: selected,
          disabled, onChange: () => toggle(item.id), 'aria-label': '选择这条消息' }), '选择'),
        item.file ? h('details', { className: 'material' }, h('summary', null,
          h('strong', null, item.file.name), h('small', { className: 'muted' }, 'DSH 材料 · 回复和附件')),
          h('div', { className: 'rows' }, body, button(`保存附件（${item.file.size} 字节）`, () => run(() => getFile(item)), disabled))) : body,
        h('div', { className: 'row spread' }, button('引用回复', () => quote(item), disabled),
          h('small', { className: 'message-meta' }, `${timeLabel(item.sentAt)} · ${statusLabels[item.status]}`)),
        item.status === 'queued' && (item.queuedRelay && item.queuedRelay !== relay?.origin
          ? h('small', null, `切回 ${item.queuedRelay} 后重试`) : button('重试投递', synchronize, disabled)))
    }

    function IncomingRequest({ request, disabled, decide }) {
      const [name, setName] = useState(request.alias ?? '')
      const [verified, setVerified] = useState(false)
      return h('fieldset', { className: 'rows', disabled },
        h('legend', null, '收到的好友申请'),
        label('申请方设备指纹', h('input', { readOnly: true, value: request.fingerprint })),
        label('好友备注名', h('input', { value: name, maxLength: 32, onChange: event => setName(event.target.value) })),
        h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: verified,
          onChange: event => setVerified(event.target.checked) }), '我已和申请方核对这个指纹'),
        h('div', { className: 'row' },
          button('接受申请', () => decide(request.id, 'accepted', name.trim(), request.fingerprint), !verified || !name.trim(), true),
          button('拒绝申请', () => decide(request.id, 'rejected'))))
    }

    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(value)
      } catch {
        throw new Error('复制失败，请选中文本后手动复制')
      }
    }

    function RelayPanel({ relay, run, locked, onRegister, suggestedOrigin }) {
      const [draft, setDraft] = useState(suggestedOrigin || relay?.origin || '')
      useEffect(() => setDraft(suggestedOrigin || relay?.origin || ''), [relay?.origin, suggestedOrigin])
      async function connect(action, input) {
        const result = await api(action, { input })
        onRegister(result)
        return '设备已连接，可以交换邀请并添加好友'
      }
      return h('section', { className: 'card', 'aria-label': '投递服务设置' },
        h('h2', null, relay?.registered ? '投递服务设置' : '连接聊天服务'),
        !relay?.registered && h('p', null, '两端连接同一个服务后，才可以交换消息。'),
        h('div', { className: 'rows' },
          button(relay?.localRunning ? '本机服务已启动' : '一键开始本机试用',
            () => run(() => connect('start-local-relay', {})), locked || relay?.localRunning, true),
          relay?.localEnabled && button('停止本机服务', () => run(async () => {
            await api('stop-local-relay', { input: {} })
            return '本机服务已停止，重新打开 DSH 后也会保持关闭'
          }), locked),
          h('small', { className: 'muted' }, '本机试用只供同一台电脑上的设备使用。已启用的本机服务会随 DSH 启动和退出。')),
        label('投递服务地址', h('input', { type: 'url', value: draft, disabled: locked,
          placeholder: 'https://relay.example.com', onChange: event => setDraft(event.target.value) })),
        h('small', null, '跨电脑聊天，请填写双方共用的私有 HTTPS 地址。'),
        h('div', { className: 'row' },
          button('测试连接', () => run(async () => {
            await api('test-relay', { input: { origin: draft.trim() } })
            return '服务可访问，点击保存并注册后使用'
          }), locked || !draft.trim()),
          button('保存并注册', () => run(() => connect('register', { origin: draft.trim() })), locked || !draft.trim(), true)))
    }

    function FriendsPanel({ invite, setInvite, requests, locked, run, relay, ready, onRelay }) {
      const [alias, setAlias] = useState('')
      const [code, setCode] = useState('')
      const [fingerprint, setFingerprint] = useState('')
      const [preview, setPreview] = useState(null)
      const [verified, setVerified] = useState(false)
      const incoming = requests.filter(item => item.direction === 'in' && item.status === 'pending')
      const outgoing = requests.filter(item => item.direction === 'out')
      const differentRelay = preview?.relay && preview.relay !== relay.origin

      function decide(id, decision, alias, fingerprint) {
        return run(async () => {
          const result = await api('decide-friend', { input: { id, decision, alias, fingerprint } })
          return (decision === 'accepted' ? '已接受好友申请' : '已拒绝好友申请') + (result.queued ? '，结果待同步' : '')
        })
      }

      return h('section', { className: 'card', 'aria-label': '好友' }, h('h2', null, '邀请和添加好友'),
        button(invite?.link ? '收起我的邀请' : '显示我的邀请', () => invite?.link ? setInvite(null) :
          run(async () => setInvite(await api('share-invite', { input: {} }))), locked || !ready),
        invite?.link && h('div', { className: 'rows' },
          h('img', { className: 'invite-qr', src: invite.qr, alt: '好友邀请二维码', width: 264, height: 264 }),
          label('邀请链接', h('textarea', { readOnly: true, rows: 2, value: invite.link })),
          label('设备指纹', h('input', { readOnly: true, value: invite.fingerprint })),
          h('div', { className: 'row' },
            button('复制邀请链接', () => run(async () => { await copyText(invite.link); return '已复制邀请链接' }), locked),
            button('复制设备指纹', () => run(async () => { await copyText(invite.fingerprint); return '已复制设备指纹' }), locked)),
          h('small', null, '请私下发送链接或二维码。接收方将链接粘贴到下方，另外通过可信渠道核对指纹。'),
          invite.relay.startsWith('http://127.0.0.1') && h('small', null, '这份邀请使用本机地址，跨电脑前请先配置私有 HTTPS 服务。')),
        incoming.map(request => h(IncomingRequest, { key: request.id, request, disabled: locked || !ready, decide })),
        h('fieldset', { className: 'rows', disabled: locked }, h('legend', null, '添加好友'),
          label('对方的邀请码或链接', h('textarea', { value: code, rows: 2, maxLength: 2300, onChange: event => {
            setCode(event.target.value)
            setPreview(null)
            setVerified(false)
          } })),
          button('读取邀请', () => run(async () => {
            setPreview(await api('read-invite', { input: { value: code.trim() } }))
            setVerified(false)
            setFingerprint('')
          }), !code.trim()),
          preview && h('div', { className: 'rows context-actions', 'aria-label': '好友邀请预览' },
            h('p', null, preview.relay ? `对方使用 ${preview.relay}` : '邀请码已读取，请确认双方使用同一个服务。'),
            differentRelay && h('div', { className: 'rows' }, h('p', null, '请先核对并连接对方的服务地址，再发送申请。'),
              button('填入对方服务地址', () => onRelay(preview.relay))),
            h('small', null, '请让对方通过可信渠道提供设备指纹，并在下方核对。')),
          label('好友备注名', h('input', { value: alias, maxLength: 32, onChange: event => setAlias(event.target.value) })),
          label('已核对的对方设备指纹', h('input', { value: fingerprint, maxLength: 64, onChange: event => {
            setFingerprint(event.target.value)
            setVerified(false)
          } })),
          h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: verified,
            disabled: !preview || fingerprint.trim().toLowerCase() !== preview.fingerprint,
            onChange: event => setVerified(event.target.checked) }), '我已通过可信渠道核对指纹'),
          button('发送好友申请', () => run(async () => {
            const result = await api('request-friend', { input: { alias: alias.trim(), code: preview.code,
              fingerprint: fingerprint.trim().toLowerCase() } })
            setAlias('')
            setCode('')
            setFingerprint('')
            setPreview(null)
            setVerified(false)
            return result.status === 'already-friend' ? '该设备已是好友' :
              result.queued ? '好友申请已保存，等待同步' : '好友申请已发送，等待对方确认'
          }), !ready || differentRelay || !preview || !verified || !alias.trim(), true)),
        outgoing.length > 0 && h('section', { 'aria-label': '发出的好友申请' }, h('h2', null, '发出的好友申请'),
          h('ul', null, outgoing.map(request => h('li', { key: request.id }, `${request.alias} · ${requestLabels[request.status]}`)))))
    }

    function MaterialPanel({ alias, current, busy, close, run, maxFileBytes }) {
      const [sessions, setSessions] = useState([])
      const [session, setSession] = useState('')
      const [replies, setReplies] = useState([])
      const [replyId, setReplyId] = useState('')
      const [file, setFile] = useState(null)
      const [snapshot, setSnapshot] = useState(null)
      const selected = replies.find(row => String(row.seq) === replyId)
      const locked = busy || !!snapshot

      async function loadReplies(id) {
        setSession(id)
        setReplyId('')
        setReplies([])
        if (!id) return
        const next = await api('replies', { id })
        setReplies(next)
        setReplyId(next[0] ? String(next[0].seq) : '')
      }
      async function loadSources(preferred) {
        const records = await api('sessions')
        setSessions(records)
        await loadReplies(records.some(row => row.id === preferred) ? preferred : records[0]?.id ?? '')
      }
      useEffect(() => { void run(() => loadSources(current)) }, [])

      async function prepare() {
        if (!selected || !file) throw new Error('请选择回复和附件')
        if (file.size > maxFileBytes) throw new Error('附件超过 128 KiB')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        setSnapshot(Object.freeze({ submission: crypto.randomUUID().replaceAll('-', ''), alias, reply: selected.text, name: file.name,
          size: bytes.length, data: encodeFile(bytes), sha256: Array.from(sha256, byte => byte.toString(16).padStart(2, '0')).join('') }))
      }

      return h('section', { className: 'card', 'aria-label': '分享材料' },
        h('header', { className: 'row spread' }, h('h2', null, '分享材料'), button('关闭材料分享', close, busy)),
        label('DSH 会话', h('select', { value: session, disabled: locked, onChange: event => {
          const id = event.target.value
          void run(() => loadReplies(id))
        } }, option('', '选择会话'), sessions.map(row => option(row.id, row.title)))),
        button('刷新会话', () => run(() => loadSources(session || current)), locked),
        label('已完成的回复', h('select', { value: replyId, disabled: locked, onChange: event => setReplyId(event.target.value) },
          option('', '选择回复'), replies.map(row => option(String(row.seq), row.text.slice(0, 88).replace(/\s+/g, ' '))))),
        label('本地文件（最多 128 KiB）', h('input', { type: 'file', disabled: locked, onChange: event => setFile(event.target.files[0] ?? null) })),
        !snapshot && button('预览材料包', () => run(prepare), !selected || !file || busy, true),
        snapshot && h('section', { className: 'card', 'aria-label': '材料包预览' },
          h('h2', null, '材料包预览'), h('p', null, `发送给 ${snapshot.alias}`), h('pre', { className: 'material-preview' }, snapshot.reply),
          h('p', null, `${snapshot.name} · ${snapshot.size} 字节`), h('small', null, `SHA-256 ${snapshot.sha256}`),
          h('div', { className: 'row' }, button('返回编辑', () => setSnapshot(null), busy),
            button('确认发送', () => run(async () => {
              const result = await api('send-bundle', { input: snapshot })
              close()
              return `材料包已保存 · ${statusLabels[result.status]}`
            }), busy, true))))
    }

    function Panel({ useSessions, openDraft }) {
      const current = useSessions(state => Object.values(state.byId)
        .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id)
      const updates = useOverview()
      const [device, setDevice] = useState(null)
      const [alias, setAlias] = useState('')
      const [feed, setFeed] = useState(null)
      const [drafts, setDrafts] = useState({})
      const [quotes, setQuotes] = useState({})
      const [searchShown, showSearch] = useState(false)
      const [searchQuery, setSearchQuery] = useState('')
      const [searchResult, setSearchResult] = useState(null)
      const [contextId, setContextId] = useState(null)
      const [settingsShown, showSettings] = useState(false)
      const [suggestedRelay, suggestRelay] = useState('')
      const [friendsShown, showFriends] = useState(false)
      const [profileShown, showProfile] = useState(false)
      const [backupShown, showBackup] = useState(false)
      const [friendQuery, setFriendQuery] = useState('')
      const [friendFilter, setFriendFilter] = useState('all')
      const [security, setSecurity] = useState(null)
      const [sharing, setSharing] = useState(false)
      const [selecting, setSelecting] = useState(false)
      const [picked, setPicked] = useState([])
      const [withFiles, includeFiles] = useState(false)
      const [highlight, setHighlight] = useState(null)
      const [invite, setInvite] = useState(null)
      const [notice, setNotice] = useState('')
      const [loadError, setLoadError] = useState('')
      const [busy, setBusy] = useState(false)
      const lock = useRef(false)
      const syncedOnOpen = useRef(false)
      const history = useRef(null)
      const atBottom = useRef(true)
      const marked = useRef(new Map())
      const active = device?.conversations.find(item => item.alias === alias)
      const relay = updates?.data?.relay ?? device?.relay
      const ready = !!relay?.registered && device?.ready
      const selectedFeed = feed?.alias === alias ? feed : null
      const newest = selectedFeed?.messages.at(-1)?.position
      const draft = Object.hasOwn(drafts, alias) ? drafts[alias] : ''
      const quote = Object.hasOwn(quotes, alias) ? quotes[alias] : null
      const conversations = device?.conversations ?? []
      const shownConversations = conversations.filter(item => item.alias.toLowerCase().includes(friendQuery.trim().toLowerCase()) &&
        (friendFilter === 'all' || item.unread))
      const items = selectedFeed?.messages ?? []
      const selectedItems = items.filter(item => picked.includes(item.id))
      const highlightedText = highlight?.alias === alias ? highlight.text : ''
      const attachments = selectedItems.filter(item => item.file).length

      async function run(work) {
        if (lock.current) return
        lock.current = true
        setBusy(true)
        setNotice('')
        try {
          const message = await work()
          if (message) setNotice(message)
          await refreshOverview()
        } catch (error) {
          setNotice(error.message)
        } finally {
          lock.current = false
          setBusy(false)
        }
      }

      useEffect(() => {
        if (!updates?.data) return
        let cancelled = false
        void api('state').then(data => {
          if (cancelled) return
          setDevice(data)
          setLoadError('')
        }, error => { if (!cancelled) setLoadError(error.message) })
        return () => { cancelled = true }
      }, [updates?.data?.revision])

      useEffect(() => {
        if (!active) return
        let cancelled = false
        void (contextId ? api('conversation-context', { input: { alias, id: contextId } }) :
          api('conversation', { id: alias })).then(next => {
          if (cancelled) return
          setFeed(previous => {
            const first = next.messages[0]?.position
            if (contextId || previous?.focus || previous?.alias !== alias || !first || !previous.messages.some(item => item.position === first)) {
              return { ...next, alias }
            }
            const preserved = previous.messages.filter(item => item.position < first)
            return { alias, messages: [...preserved, ...next.messages], previous: preserved.length ? previous.previous : next.previous }
          })
          setLoadError('')
        }, error => { if (!cancelled) setLoadError(error.message) })
        return () => { cancelled = true }
      }, [alias, !!active, contextId, updates?.data?.revision])

      useEffect(() => {
        if (!ready || syncedOnOpen.current) return
        syncedOnOpen.current = true
        void api('sync', { input: {} }).then(refreshOverview, refreshOverview)
      }, [ready])

      useEffect(() => {
        const list = history.current
        if (selectedFeed?.focus && list) {
          const target = list.querySelector('[data-focus=true]')
          if (target) list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top -
            (list.clientHeight - target.clientHeight) / 2
        } else if (newest && list && atBottom.current) list.scrollTop = list.scrollHeight
      }, [alias, newest, selectedFeed?.focus])

      useEffect(() => {
        function markVisible() {
          if (document.visibilityState !== 'visible' || !document.hasFocus() || !history.current?.getClientRects().length ||
              contextId || !active?.unread || !newest ||
              (marked.current.get(alias) ?? 0) >= newest) return
          marked.current.set(alias, newest)
          void api('mark-read', { input: { alias, position: newest } }).then(refreshOverview, () => {
            if (marked.current.get(alias) === newest) marked.current.delete(alias)
          })
        }
        markVisible()
        document.addEventListener('visibilitychange', markVisible)
        window.addEventListener('focus', markVisible)
        return () => {
          document.removeEventListener('visibilitychange', markVisible)
          window.removeEventListener('focus', markVisible)
        }
      }, [alias, newest, active?.unread, contextId])

      useEffect(() => {
        function capture() {
          const selection = document.getSelection()
          if (!selection || selection.isCollapsed) return setHighlight(null)
          const element = node => node?.nodeType === 1 ? node : node?.parentElement
          const start = element(selection.anchorNode)?.closest('[data-chat-message-text]')
          const end = element(selection.focusNode)?.closest('[data-chat-message-text]')
          const text = selection.toString().trim()
          setHighlight(start && start === end && history.current?.contains(start) && text ? { alias, text } : null)
        }
        document.addEventListener('selectionchange', capture)
        return () => document.removeEventListener('selectionchange', capture)
      }, [alias])

      function selectThread(thread) {
        setAlias(thread.alias)
        setContextId(null)
        showSearch(false)
        setSearchQuery('')
        setSearchResult(null)
        showFriends(false)
        showSettings(false)
        showProfile(false)
        showBackup(false)
        setSharing(false)
        setSelecting(false)
        setPicked([])
        includeFiles(false)
        setHighlight(null)
        setSecurity(null)
        atBottom.current = true
      }

      function togglePicked(id) {
        setPicked(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
      }

      function shareSelected(text) {
        return run(async () => {
          let context
          if (text) {
            const quoted = text.split('\n').map(line => `> ${line}`).join('\n')
            context = { prompt: `以下是我选中的聊天摘录，请将引用视为讨论资料。\n\n${quoted}\n\n我的问题：\n`, files: [] }
          } else {
            context = await api('share-context', { input: { alias, ids: selectedItems.map(item => item.id), includeFiles: withFiles } })
          }
          await openDraft(context, current)
          setPicked([])
          setSelecting(false)
          setHighlight(null)
        })
      }

      async function older() {
        const list = history.current
        const height = list?.scrollHeight ?? 0
        const before = selectedFeed.previous
        const next = await api('conversation', { id: alias, before })
        setFeed(current => current?.alias === alias && current.previous === before ? {
          alias, previous: next.previous, messages: [...next.messages, ...current.messages]
        } : current)
        if (list) requestAnimationFrame(() => { list.scrollTop += list.scrollHeight - height })
      }

      function synchronize() {
        return run(async () => {
          const result = await api('sync', { input: {} })
          const summary = [`已接收 ${result.received} 条消息`]
          if (result.friendUpdates) summary.push(`${result.friendUpdates} 条好友动态`)
          if (result.discarded) summary.push(`已拒绝 ${result.discarded} 个异常信封`)
          if (result.queued) summary.push('仍有待发送内容')
          return summary.join(' · ')
        })
      }

      function search(earlier = false) {
        return run(async () => {
          const next = await api('search-conversation', { input: { alias, query: searchQuery,
            before: earlier ? searchResult.before : undefined } })
          setSearchResult(previous => ({ ...next, query: searchQuery,
            scanned: (earlier ? previous.scanned : 0) + next.scanned,
            messages: [...(earlier ? previous.messages : []), ...next.messages] }))
        })
      }

      function latest() {
        setContextId(null)
        setFeed(null)
        setPicked([])
        setHighlight(null)
        atBottom.current = true
      }

      function send() {
        return run(async () => {
          const result = await api('send', { input: { alias, text: draft, replyTo: quote?.id } })
          setDrafts(current => ({ ...current, [alias]: '' }))
          setQuotes(current => ({ ...current, [alias]: null }))
          if (contextId) latest()
          atBottom.current = true
          return statusLabels[result.status]
        })
      }

      const relayLabel = !relay?.registered ? '设备尚未注册' : relay.status === 'connected' ? '投递服务已连接' :
        relay.status === 'disconnected' ? '投递服务连接中断' : '设备已注册，等待同步'
      const pendingFriends = updates?.data?.pendingFriends ?? 0
      const version = updates?.data?.version
      const profile = device?.profile
      let historyHint = '这里会显示你和这位好友的对话。'
      if (!device) historyHint = '正在读取本地对话…'
      else if (!active) {
        if (device.conversations.length) historyHint = '选择好友以查看对话。'
        else historyHint = ready ? '添加好友后即可聊天。' : '先在投递设置中连接服务，再添加好友。'
      } else if (!selectedFeed) historyHint = '正在读取聊天记录…'
      const messageRows = items.flatMap((item, index) => [
        (!index || dayKey(items[index - 1].sentAt) !== dayKey(item.sentAt)) &&
          h('small', { key: `day-${item.id}`, className: 'day muted' }, dayLabel(item.sentAt)),
        h(ChatMessage, { key: item.id, item, selecting, selected: picked.includes(item.id),
          disabled: busy || picked.length >= 10 && !picked.includes(item.id), toggle: togglePicked, synchronize, run, relay, focused: item.id === selectedFeed?.focus,
          quote: item => setQuotes(current => ({ ...current, [alias]: item })) })
      ])
      return h('section', { className: 'private-chat', 'aria-label': displayName }, h('style', null, styles),
        h('div', null,
          h('header', { className: 'row top' },
            h('div', { className: 'row' }, h(Avatar, { name: profile?.name, url: profile?.avatarUrl }),
              h('div', { className: 'rows' },
                h('div', { className: 'row' }, h('h1', null, displayName),
                  version && h('small', { className: 'muted' }, `版本 ${version}`)),
                h('small', { className: 'muted' }, relayLabel),
                relay?.lastSyncAt && h('small', { className: 'muted' }, `上次同步 ${timeLabel(relay.lastSyncAt)}`))),
            h('div', { className: 'row' },
              button(pendingFriends ? `好友管理 · ${pendingFriends}` : '好友管理', () => showFriends(value => !value), !device || busy),
              button('个人资料', () => showProfile(value => !value), !device || busy),
              button('加密备份', () => showBackup(value => !value), !device?.ready || busy),
              button('投递设置', () => showSettings(value => !value), !relay || busy),
              button('同步收件', synchronize, !device?.ready || busy))),
          h('output', { role: 'status' }, busy ? '处理中…' : notice || loadError || updates?.error),
          relay?.registered && relay.status === 'disconnected' && h('div', { className: 'row context-actions', role: 'alert' },
            h('span', null, '连接已中断，待发消息保存在本机。恢复后会自动重试。'),
            button('立即重连', synchronize, busy)),
          profileShown && h(ProfilePanel, { profile, disabled: busy, run }),
          backupShown && device?.ready && h(BackupPanel, { busy, run }),
          device && !conversations.length && h('section', { className: 'card', 'aria-label': '开始聊天' },
            h('h2', null, ready ? '添加第一位好友' : '开始使用 dsh-DeepChat'),
            h('p', null, ready ? '交换邀请并核对设备指纹，对方接受后就能聊天。' : '先连接聊天服务，也可以粘贴好友邀请查看对方的服务地址。'),
            ready && button('邀请或添加好友', () => showFriends(true), busy)),
          relay && (settingsShown || !relay.registered) && h(RelayPanel, { relay, run, locked: busy, suggestedOrigin: suggestedRelay,
            onRegister(value) {
              setInvite(null)
              suggestRelay('')
              showSettings(false)
              showFriends(true)
            } }),
          device && (friendsShown || !ready) && h(FriendsPanel, { invite, setInvite, requests: device.requests, locked: busy, run, relay, ready,
            onRelay(origin) { suggestRelay(origin); showSettings(true) } }),
          h('div', { className: 'workspace' },
            h('nav', { className: 'threads', 'aria-label': '好友列表' }, h('h2', { className: 'roster-heading' }, '好友列表'),
              h('input', { type: 'search', placeholder: '搜索好友', 'aria-label': '搜索好友', value: friendQuery,
                onChange: event => setFriendQuery(event.target.value) }),
              h('div', { className: 'row', 'aria-label': '会话筛选' },
                [['all', '全部'], ['unread', '未读']].map(([value, text]) => h('button', { type: 'button', key: value,
                  className: 'filter', 'aria-pressed': friendFilter === value, onClick: () => setFriendFilter(value) }, text))),
              shownConversations.length ? shownConversations.map(thread => h('button', {
                key: thread.alias, type: 'button', className: 'thread', 'aria-current': alias === thread.alias ? 'true' : undefined,
                'aria-label': thread.unread ? `${thread.alias}，${thread.unread} 条未读` : thread.alias, disabled: busy,
                onClick: () => selectThread(thread)
              }, h(Avatar, { name: thread.alias }), h('span', { className: 'rows' }, h('strong', null, thread.alias),
                thread.preview && h('small', { className: 'preview' }, thread.preview)),
              h('span', { className: 'rows' }, thread.lastAt && h('small', { className: 'muted' }, timeLabel(thread.lastAt)),
                thread.unread > 0 && h('small', { className: 'unread-count' }, thread.unread)))) :
                h('p', { className: 'muted' }, device ? (conversations.length ? '没有匹配的会话' : '暂无好友') : '正在读取好友列表…'),
              button('添加好友', () => showFriends(true), busy || !device)),
            h('section', { className: 'chat-pane', 'aria-label': '聊天框' },
              h('header', { className: 'chat-header rows' }, h('div', { className: 'row spread' },
                h('div', { className: 'row' }, active && h(Avatar, { name: alias }), h('h2', null, active?.alias ?? '聊天')),
                active && h('div', { className: 'row' }, button(searchShown ? '收起搜索' : '搜索聊天', () => showSearch(value => !value), busy), button(security?.alias === alias ? '收起好友指纹' : '好友指纹', () => {
                  if (security?.alias === alias) return setSecurity(null)
                  return run(async () => setSecurity({ alias, ...await api('contact-security', { id: alias }) }))
                }, busy), button(selecting ? '取消选中' : '选择消息', () => {
                  setSelecting(!selecting)
                  setPicked([])
                  includeFiles(false)
                }, busy || !items.length))), security?.alias === alias && h('code', { className: 'security-code',
                  'aria-label': '好友设备指纹' }, security.fingerprint.match(/.{1,4}/g).join(' ')),
                active && searchShown && h('section', { className: 'rows', 'aria-label': '搜索聊天记录' },
                  h('form', { className: 'row', onSubmit: event => { event.preventDefault(); void search() } },
                    h('input', { type: 'search', value: searchQuery, maxLength: 128, disabled: busy,
                      placeholder: '搜索文字或附件名', 'aria-label': '搜索聊天内容', onChange: event => {
                        setSearchQuery(event.target.value); setSearchResult(null)
                      } }),
                    h('button', { type: 'submit', disabled: busy || !searchQuery.trim() }, '搜索本机记录')),
                  h('small', { className: 'muted' }, '仅在本机搜索。每次检查 100 条，按时间从新到旧显示。'),
                  searchResult && h('div', { className: 'rows search-results', 'aria-label': '搜索结果' },
                    h('small', { role: 'status' }, `已检查 ${searchResult.scanned} 条，找到 ${searchResult.messages.length} 条`),
                    searchResult.messages.map(item => h('button', { key: item.id, type: 'button', className: 'search-result', disabled: busy,
                      onClick: () => { setPicked([]); setHighlight(null); if (contextId !== item.id) { setContextId(item.id); setFeed(null) } } },
                      h('small', null, `${item.direction === 'in' ? alias : '我'} · ${timeLabel(item.sentAt)} · 查看上下文`),
                      item.file && h('strong', null, item.file.name), h('pre', null, item.text))),
                    searchResult.before ? button('继续搜索更早记录', () => search(true), busy) : h('small', null, '已搜索全部记录'))),
                contextId && h('div', { className: 'row context-actions' }, h('span', null, '正在查看搜索结果的前后文'),
                  button('返回最新消息', latest, busy))),
              h('div', { className: 'history', ref: history, role: 'log', 'aria-live': 'off', 'aria-label': '聊天上下文', onScroll: event => {
                const list = event.currentTarget
                atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80
              } }, selectedFeed?.previous && button('查看更早消息', () => run(older), busy),
                items.length ? messageRows : h('p', { className: 'muted' }, historyHint)),
              h('div', { className: 'rows composer' },
                quote && h('div', { className: 'rows quote-preview', 'aria-label': '待发送引用' },
                  h('div', { className: 'row spread' }, h('small', null, `引用 ${quote.direction === 'in' ? alias : '我'}`),
                    button('取消引用', () => setQuotes(current => ({ ...current, [alias]: null })), busy)),
                  h('pre', null, Array.from(quote.text).slice(0, 600).join('') + (Array.from(quote.text).length > 600 ? '…' : ''))),
                selectedItems.length > 0 && h('div', { className: 'row spread context-actions' },
                  h('span', null, `已选 ${selectedItems.length} 条消息`), attachments > 0 && h('label', { className: 'message-select' },
                    h('input', { type: 'checkbox', checked: withFiles, onChange: event => includeFiles(event.target.checked) }), `带入 ${attachments} 个附件`),
                  button('带到 DSH 新会话', () => shareSelected(), busy, true)),
                !selecting && highlightedText && h('div', { className: 'row spread context-actions' }, h('span', null, '已选中文字'),
                  h('button', { type: 'button', className: 'primary', disabled: busy, onMouseDown: event => event.preventDefault(),
                    onClick: () => shareSelected(highlightedText) }, '带到 DSH 新会话')),
                sharing && ready && active && h(MaterialPanel, { key: alias, alias, current, busy, close: () => setSharing(false), run, maxFileBytes: device.maxFileBytes }),
                label(active ? `发给 ${alias} 的消息` : '消息', h('textarea', { rows: 2, value: active ? draft : '', disabled: busy || !active,
                  placeholder: active ? '输入消息' : '先选择好友',
                  onKeyDown: event => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && active && ready && draft.trim()) {
                      event.preventDefault()
                      void send()
                    }
                  },
                  onChange: event => {
                    const text = event.target.value
                    setDrafts(current => ({ ...current, [alias]: text }))
                  } })),
                h('div', { className: 'row' }, button('分享材料', () => setSharing(true), busy || sharing || !active || !ready),
                  button('发送文字', send, busy || !active || !ready || !draft.trim(), true)))))))
    }

    function Icon({ size = 18 }) {
      const updates = useOverview()
      const unread = updates?.data?.unread ?? 0
      const friends = updates?.data?.pendingFriends ?? 0
      const count = unread + friends
      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M5 4.5h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H9l-5 3v-3.3A2 2 0 0 1 3 15V6.5a2 2 0 0 1 2-2Z M8 10.5h8' })),
        count > 0 && h('span', { 'aria-label': `${unread} 条未读消息，${friends} 条好友申请`,
          title: `${unread} 条未读消息 · ${friends} 条好友申请`, style: { position: 'absolute', top: -6, right: -8,
            minWidth: 13, padding: '0 2px', borderRadius: 12, background: '#ba3244', color: '#fff', fontSize: 9,
            lineHeight: '13px', textAlign: 'center', pointerEvents: 'none' } }, count > 99 ? '99+' : count))
    }

    return {
      inject: ['slots', 'layout', 'sessions', 'workspaces', 'conversation', 'uiWorkspace'],
      apply(ctx) {
        const ChatPanel = props => h(Panel, { ...props, openDraft: (context, current) => openHarnessDraft(ctx, context, current) })
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel }, ChatPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 6, label: displayName }, Icon))
      }
    }
  }
})
