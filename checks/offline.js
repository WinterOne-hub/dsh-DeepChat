import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { initializeDevice, openDevice } from '../src/client.js'
import { maxFileBytes } from '../src/bundle.js'
import { createHandler } from '../src/host.js'
import { createIdentity, hash, maxTextBytes, newPayload, readInvitation, retentionMs, seal } from '../src/protocol.js'
import { openRelay } from '../src/relay.js'
import { readSharedInvitation, shareInvitation } from '../src/invitation-share.js'
import { startLocalRelay } from '../src/relay-server.js'

async function setup(t, { paired = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-test-'))
  const devices = new Set()
  let time = Date.now()
  const now = () => time
  let relay = openRelay(join(root, 'relay'), { now })
  const request = outgoing => relay.handle(outgoing)
  function connect(name, transport = request) {
    const device = openDevice(join(root, name), { request: transport, now })
    devices.add(device)
    return device
  }
  function disconnect(device) {
    device.close()
    devices.delete(device)
  }
  t.after(async () => {
    for (const device of devices) device.close()
    relay.close()
    await rm(root, { recursive: true, force: true })
  })

  await Promise.all(['alice', 'bob'].map(name => initializeDevice(join(root, name))))
  const alice = connect('alice')
  const bob = connect('bob')
  await Promise.all([alice.register(), bob.register()])
  const inviteAlice = alice.invitation()
  const inviteBob = bob.invitation()
  if (paired) {
    await assert.rejects(alice.trust('bob', inviteBob.code, 'wrong'), /fingerprint differs/)
    await alice.trust('bob', inviteBob.code, inviteBob.fingerprint)
    await bob.trust('alice', inviteAlice.code, inviteAlice.fingerprint)
  }
  return {
    alice, bob, connect, disconnect, root, request, now,
    advance: elapsed => { time += elapsed },
    restart() {
      relay.close()
      relay = openRelay(join(root, 'relay'), { now })
    }
  }
}

test('offline delivery survives relay restart and retries an interrupted acknowledgement', async t => {
  const lab = await setup(t)
  lab.disconnect(lab.bob)
  const text = '离线测试专用内容 qf9zd37，服务端存储里应只有密文。'
  const sent = await lab.alice.send('bob', text)
  assert.equal(sent.status, 'stored')
  lab.disconnect(lab.alice)
  for (const path of ['relay/relay.sqlite-wal', 'alice/device.sqlite']) {
    assert.equal((await readFile(join(lab.root, path))).includes(Buffer.from(text)), false)
  }
  lab.restart()

  let dropped = false
  const recoveringBob = lab.connect('bob', outgoing => {
    if (outgoing.method === 'DELETE' && !dropped) {
      dropped = true
      throw new Error('Connection cut before mailbox acknowledgement')
    }
    return lab.request(outgoing)
  })
  await assert.rejects(recoveringBob.sync(), /Connection cut/)
  assert.equal((await recoveringBob.history()).length, 1)
  lab.disconnect(recoveringBob)

  const bob = lab.connect('bob')
  assert.deepEqual(await bob.sync(), { received: 0, discarded: 0, queued: 0 })
  assert.deepEqual(await bob.history(), [{ id: sent.id, contact: 'alice', direction: 'in', status: 'received', text }])
  const alice = lab.connect('alice')
  assert.equal((await alice.history())[0].status, 'stored')
  await alice.sync()
  assert.equal((await alice.history())[0].status, 'delivered')
})

test('rejects wrong mailbox capability, then discards tampered ciphertext', async t => {
  const lab = await setup(t)
  const bobInvite = lab.bob.invitation()
  const { mailbox, writeToken } = JSON.parse(Buffer.from(bobInvite.code, 'base64url'))
  const url = `http://relay.test/v1/mailboxes/${mailbox}`
  const readAsWriter = await lab.request(new Request(url, { headers: { authorization: `Bearer ${writeToken}` } }))
  assert.equal(readAsWriter.status, 403)

  lab.disconnect(lab.alice)
  const alice = lab.connect('alice', async outgoing => {
    if (outgoing.method !== 'PUT') return lab.request(outgoing)
    const body = await outgoing.json()
    const original = body.sealed
    const parts = body.sealed.split('.')
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1)
    body.sealed = parts.join('.')
    const denied = await lab.request(new Request(outgoing.url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
      body: JSON.stringify({ ...body, sealed: original })
    }))
    assert.equal(denied.status, 403)
    return lab.request(new Request(outgoing.url, {
      method: 'PUT', headers: outgoing.headers, body: JSON.stringify(body)
    }))
  })
  assert.equal((await alice.send('bob', 'message')).status, 'stored')
  assert.deepEqual(await lab.bob.sync(), { received: 0, discarded: 1, queued: 0 })
  assert.deepEqual(await lab.bob.history(), [])
  assert.equal((await alice.history())[0].status, 'stored')
})

test('retries the persisted outgoing envelope and exposes expired unconfirmed delivery', async t => {
  const lab = await setup(t)
  lab.disconnect(lab.alice)
  let firstUpload
  const alice = lab.connect('alice', async outgoing => {
    const copy = outgoing.clone()
    const response = await lab.request(outgoing)
    if (outgoing.method === 'PUT' && !firstUpload) {
      firstUpload = await copy.text()
      assert.equal(response.status, 201)
      throw new Error('Lost relay response')
    }
    return response
  })
  const sent = await alice.send('bob', 'retry and expire')
  assert.equal(sent.status, 'queued')
  assert.ok(firstUpload)
  lab.disconnect(alice)
  const recovered = lab.connect('alice', async outgoing => {
    if (outgoing.method === 'PUT') assert.equal(await outgoing.clone().text(), firstUpload)
    return lab.request(outgoing)
  })
  await recovered.sync()
  assert.equal((await recovered.history())[0].status, 'stored')
  lab.advance(retentionMs + 1)
  assert.deepEqual(await lab.bob.sync(), { received: 0, discarded: 0, queued: 0 })
  assert.equal((await recovered.history())[0].status, 'expired-unconfirmed')
})

test('accepts maximum-size UTF-8 text even when it contains JSON escape characters', async t => {
  const lab = await setup(t)
  const text = '\u0000'.repeat(maxTextBytes - 3) + '中'
  await assert.rejects(lab.alice.send('bob', text + 'x'), /8192 UTF-8 bytes/)
  assert.equal((await lab.alice.send('bob', text)).status, 'stored')
  assert.equal((await lab.bob.sync()).received, 1)
  assert.equal((await lab.bob.history())[0].text, text)
})

test('resumes interrupted material delivery and verifies the exact original file before receipt', async t => {
  const lab = await setup(t)
  const bytes = randomBytes(maxFileBytes)
  const snapshot = {
    reply: '可以分享的 DSH 回复', name: '报告.pdf', size: bytes.length, data: bytes.toString('base64url'),
    sha256: hash(bytes), submission: randomBytes(16).toString('hex')
  }
  lab.disconnect(lab.alice)
  let uploads = 0
  const alice = lab.connect('alice', outgoing => {
    if (outgoing.method === 'PUT' && ++uploads === 3) throw new Error('Network interrupted before part 3')
    return lab.request(outgoing)
  })
  await assert.rejects(alice.sendBundle('bob', { ...snapshot, sha256: '0'.repeat(64) }), /differs from preview/)
  const sent = await alice.sendBundle('bob', snapshot)
  assert.equal(sent.status, 'queued')
  assert.equal(uploads, 3)
  assert.deepEqual(await lab.bob.sync(), { received: 0, discarded: 0, queued: 0 })
  assert.deepEqual(await lab.bob.history(), [])
  lab.disconnect(alice)
  lab.disconnect(lab.bob)
  lab.restart()

  const sender = lab.connect('alice')
  const retried = await sender.sendBundle('bob', snapshot)
  assert.deepEqual(retried, { id: sent.id, status: 'stored' })
  assert.equal((await sender.history()).length, 1)
  lab.disconnect(sender)

  const bob = lab.connect('bob')
  assert.deepEqual(await bob.sync(), { received: 1, discarded: 0, queued: 0 })
  assert.deepEqual(await bob.history(), [{
    id: sent.id, contact: 'alice', direction: 'in', status: 'received', text: snapshot.reply,
    file: { name: snapshot.name, size: bytes.length, sha256: snapshot.sha256 }
  }])
  assert.deepEqual(await bob.download(sent.id), { name: snapshot.name, bytes })
  assert.equal((await bob.sync()).received, 0)
  const confirmed = lab.connect('alice')
  await confirmed.sync()
  assert.equal((await confirmed.history())[0].status, 'delivered')
})

test('local DSH route presents final reply text only and delivers the confirmed snapshot', async t => {
  const lab = await setup(t)
  const synthetic = (turn, seq, content) => ({ type: 'assistant/message', surfaceOp: 'append', seq, time: seq, data: { turn, message: { content } } })
  const end = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })
  const events = [
    synthetic(1, 1, [{ type: 'text', text: '工具调用前的内容' }, { type: 'tool-call', name: 'secret' }]),
    synthetic(1, 2, [{ type: 'reasoning', text: '隐藏思考' }, { type: 'text', text: '这段回复可分享' }]), end(1),
    synthetic(2, 4, [{ type: 'text', text: '这次回复被中止' }]), end(2, 'aborted'),
    synthetic(3, 6, [{ type: 'text', text: '工具等待' }, { type: 'tool-call', name: 'secret' }]), end(3),
    synthetic(4, 8, [{ type: 'text', text: '还没结束' }])
  ]
  const handler = createHandler({
    directory: join(lab.root, 'alice'), deviceOptions: { request: lab.request, now: lab.now },
    sessions: {
      listSessions: async () => [{ header: { id: 'session-id' } }, { header: { id: 'hidden', origin: 'subagent' } }],
      readTitleSnapshots: async ids => ids.map(() => ({ value: { title: { title: '测试会话' } } })),
      readSession: async () => ({ events })
    }
  })
  const call = (query, body, extraHeaders = {}) => handler(new Request(`http://dsh.internal/api/private-chat?${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { host: '127.0.0.1:5421', 'x-dsh-private-chat': '1', 'content-type': 'application/json', ...extraHeaders },
    body: body && JSON.stringify(body)
  }))
  assert.equal((await call('action=sessions', null, { origin: 'https://injected.invalid' })).status, 403)
  assert.equal((await call('action=sessions', null, { host: 'not-local.invalid' })).status, 403)
  assert.deepEqual(await (await call('action=sessions')).json(), [{ id: 'session-id', title: '测试会话' }])
  const selection = await (await call('action=replies&id=session-id')).json()
  assert.deepEqual(selection, [{ seq: 2, time: 2, text: '这段回复可分享' }])
  const bytes = Buffer.from('confirmed snapshot attachment')
  const snapshot = { action: 'send-bundle', alias: 'bob', reply: selection[0].text, name: '材料.txt',
    size: bytes.length, data: bytes.toString('base64url'), sha256: hash(bytes), submission: randomBytes(16).toString('hex') }
  assert.equal((await call('', { ...snapshot, name: '../材料.txt' })).status, 400)
  const sent = await (await call('', snapshot)).json()
  assert.equal(sent.status, 'stored')
  assert.equal((await lab.bob.sync()).received, 1)
  const response = await call(`action=download&id=${sent.id}`)
  assert.equal(response.headers.get('content-type'), 'application/octet-stream')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

test('offline friend request requires explicit fingerprint approval and enables reciprocal chat once', async t => {
  const lab = await setup(t, { paired: false })
  const aliceInvite = lab.alice.invitation()
  const bobInvite = lab.bob.invitation()
  lab.disconnect(lab.bob)
  await assert.rejects(lab.alice.requestFriend('小鲍', bobInvite.code, 'wrong'), /fingerprint differs/)
  const sent = await lab.alice.requestFriend('小鲍', bobInvite.code, bobInvite.fingerprint)
  assert.deepEqual(await lab.alice.requestFriend('小鲍', bobInvite.code, bobInvite.fingerprint), sent)
  assert.equal(sent.queued, false)
  assert.deepEqual(lab.alice.contacts(), [])
  await assert.rejects(lab.alice.send('小鲍', '没有通过申请'), /Pair with this contact first/)
  lab.disconnect(lab.alice)
  lab.restart()

  const bob = lab.connect('bob')
  assert.equal((await bob.sync()).friendUpdates, 1)
  const [request] = bob.requests()
  assert.equal(request.id, sent.id)
  assert.equal(request.fingerprint, aliceInvite.fingerprint)
  assert.deepEqual(bob.contacts(), [])
  await assert.rejects(bob.decideFriend(request.id, 'accepted', '小艾', 'wrong'), /核对/)
  assert.deepEqual(await bob.decideFriend(request.id, 'accepted', '小艾', aliceInvite.fingerprint), { status: 'accepted', queued: false })
  await bob.decideFriend(request.id, 'accepted', '小艾', aliceInvite.fingerprint)
  assert.deepEqual(bob.contacts(), ['小艾'])
  await bob.send('小艾', '接受后可以发消息')

  const alice = lab.connect('alice')
  const received = await alice.sync()
  assert.equal(received.friendUpdates, 1)
  assert.equal(received.received, 1)
  assert.equal(alice.requests()[0].status, 'accepted')
  assert.deepEqual(alice.contacts(), ['小鲍'])
  assert.equal((await alice.history())[0].text, '接受后可以发消息')
  assert.equal((await alice.sync()).friendUpdates, undefined)
})

test('forged approvals cannot add contacts and a signed rejection leaves both sides unpaired', async t => {
  const lab = await setup(t, { paired: false })
  const toAlice = await readInvitation(lab.alice.invitation().code)
  const bobInvite = lab.bob.invitation()
  const bob = await readInvitation(bobInvite.code)
  const sent = await lab.alice.requestFriend('bob', bobInvite.code, bobInvite.fingerprint)

  const impostor = { ...await createIdentity(), mailbox: bob.mailbox }
  const forged = newPayload(impostor, toAlice, lab.now(), { type: 'friend-response', requestId: sent.id, decision: 'accepted' })
  const response = await lab.request(new Request(`http://relay.test/v1/mailboxes/${toAlice.mailbox}/${forged.id}`, {
    method: 'PUT', headers: { authorization: `Bearer ${toAlice.writeToken}` },
    body: JSON.stringify({ sealed: await seal(impostor, toAlice, forged), expires: forged.expires })
  }))
  assert.equal(response.status, 201)
  assert.equal((await lab.alice.sync()).discarded, 1)
  assert.deepEqual(lab.alice.contacts(), [])
  assert.equal(lab.alice.requests()[0].status, 'pending')

  await lab.bob.sync()
  assert.equal((await lab.bob.decideFriend(sent.id, 'rejected')).status, 'rejected')
  assert.equal((await lab.alice.sync()).friendUpdates, 1)
  assert.equal(lab.alice.requests()[0].status, 'rejected')
  assert.deepEqual(lab.bob.contacts(), [])
  assert.deepEqual(lab.alice.contacts(), [])
  await assert.rejects(lab.bob.decideFriend(sent.id, 'accepted', 'alice', lab.alice.invitation().fingerprint), /已处理或过期/)
})

test('conversation history and read positions stay isolated by friend and survive reopening', async t => {
  const lab = await setup(t)
  await initializeDevice(join(lab.root, 'carol'))
  const carol = lab.connect('carol')
  await carol.register()
  const aliceInvite = lab.alice.invitation()
  const carolInvite = carol.invitation()
  await lab.alice.trust('carol', carolInvite.code, carolInvite.fingerprint)
  await carol.trust('alice', aliceInvite.code, aliceInvite.fingerprint)
  await lab.bob.send('alice', '来自 Bob')
  await carol.send('alice', '来自 Carol')
  assert.equal((await lab.alice.sync()).received, 2)
  assert.equal(lab.alice.unread(), 2)
  assert.deepEqual((await lab.alice.conversations()).map(row => [row.alias, row.unread]), [['carol', 1], ['bob', 1]])
  const bob = await lab.alice.conversation('bob')
  const c = await lab.alice.conversation('carol')
  assert.deepEqual(bob.messages.map(message => message.text), ['来自 Bob'])
  assert.throws(() => lab.alice.markRead('bob', c.messages[0].position), /不属于/)

  await lab.bob.send('alice', '读位置之后的新消息')
  await lab.alice.sync()
  assert.equal(lab.alice.markRead('bob', bob.messages[0].position), true)
  assert.equal(lab.alice.markRead('bob', bob.messages[0].position), false)
  lab.disconnect(lab.alice)
  const alice = lab.connect('alice')
  assert.equal(alice.unread(), 2)
  assert.deepEqual((await alice.conversations()).map(row => [row.alias, row.unread]), [['bob', 1], ['carol', 1]])
  assert.deepEqual((await alice.conversation('bob')).messages.map(message => message.text), ['来自 Bob', '读位置之后的新消息'])
})

test('automatic host sync reports unread and preserves queued deliveries when changing relays', async t => {
  const lab = await setup(t)
  const relay2 = openRelay(join(lab.root, 'second-relay'), { now: lab.now })
  const relay2Origin = 'https://second-relay.test'
  const oldOrigin = 'http://127.0.0.1:8611'
  let dropOriginalUpload = false
  const secondWrites = []
  const request = outgoing => {
    const origin = new URL(outgoing.url).origin
    if (origin === relay2Origin) {
      if (outgoing.method === 'GET' && outgoing.url.endsWith('0'.repeat(64))) assert.equal(outgoing.headers.has('authorization'), false)
      if (outgoing.method === 'PUT' && new URL(outgoing.url).pathname.split('/').length === 5) secondWrites.push(outgoing.url)
      return relay2.handle(outgoing)
    }
    if (origin !== oldOrigin || (dropOriginalUpload && outgoing.method === 'PUT')) throw new Error('Relay offline')
    return lab.request(outgoing)
  }
  const handler = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: { request, now: lab.now }, pollMs: 12 })
  const stop = handler.start()
  t.after(() => { stop(); relay2.close() })
  const call = async (action, input, id = '') => {
    const response = await handler(new Request(`http://127.0.0.1/api/private-chat?action=${action}&id=${id}`, {
      headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' }, method: input ? 'POST' : 'GET',
      body: input && JSON.stringify({ action, ...input })
    }))
    return { status: response.status, value: await response.json() }
  }
  await lab.bob.send('alice', '应用后台收件')
  let summary
  for (let attempt = 0; attempt < 25; attempt++) {
    summary = (await call('overview')).value
    if (summary.unread === 1) break
    await new Promise(resolve => setTimeout(resolve, 12))
  }
  assert.equal(summary.unread, 1)
  assert.equal(summary.relay.registered, true)
  assert.equal(summary.relay.origin, oldOrigin)
  const stored = (await call('conversation', undefined, 'bob')).value
  assert.equal(stored.messages[0].text, '应用后台收件')
  assert.deepEqual((await call('mark-read', { alias: 'bob', position: stored.messages[0].position })).value, { changed: true })
  assert.equal((await call('overview')).value.unread, 0)

  dropOriginalUpload = true
  assert.equal((await call('send', { alias: 'bob', text: '只留在原服务的待发队列' })).value.status, 'queued')
  assert.equal((await call('test-relay', { origin: 'http://second-relay.test' })).status, 400)
  assert.equal((await call('register', { origin: 'https://wrong-relay.test' })).status, 400)
  assert.equal((await call('overview')).value.relay.origin, oldOrigin)
  assert.equal((await call('test-relay', { origin: relay2Origin })).value.reachable, true)
  assert.equal((await call('overview')).value.relay.origin, oldOrigin)
  assert.equal((await call('register', { origin: relay2Origin })).value.relay.registered, true)
  await call('sync', {})
  assert.deepEqual(secondWrites, [])
  const pending = (await call('conversation', undefined, 'bob')).value.messages.at(-1)
  assert.equal(pending.status, 'queued')
  assert.equal(pending.queuedRelay, oldOrigin)

  const reopened = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: { request, now: lab.now } })
  const reopenedOverview = await reopened(new Request('http://127.0.0.1/api/private-chat?action=overview', {
    headers: { 'x-dsh-private-chat': '1' }
  }))
  assert.equal((await reopenedOverview.json()).relay.origin, relay2Origin)
  dropOriginalUpload = false
  await call('register', { origin: oldOrigin })
  await call('sync', {})
  await lab.bob.sync()
  assert.equal((await lab.bob.history()).at(-1).text, '只留在原服务的待发队列')
})

test('DeepSeek chat profile shows only display fields and needs confirmation for the same account', async t => {
  const lab = await setup(t)
  let account = {
    issuer: 'https://platform.deepseek.com', id: 'account-a', name: '测试昵称',
    avatarUrl: 'https://platform.deepseek.com/fake-avatar.png', token: 'never expose this', contact: 'masked phone'
  }
  const handler = createHandler({ directory: join(lab.root, 'alice'), readAccount: async () => account })
  async function call(action, input) {
    const response = await handler(new Request(`http://127.0.0.1/api/private-chat?action=${action}`, {
      method: input ? 'POST' : 'GET', headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
      body: input && JSON.stringify({ action, ...input })
    }))
    return { status: response.status, value: await response.json() }
  }
  await call('save-manual-profile', { name: '本机备注' })
  const preview = (await call('preview-account-profile', {})).value
  assert.deepEqual(Object.keys(preview).sort(), ['avatarUrl', 'name', 'ticket'])
  assert.equal((await call('state')).value.profile.name, '本机备注')
  account = { ...account, id: 'account-b' }
  assert.equal((await call('save-account-profile', { ticket: preview.ticket })).status, 400)
  const confirmed = (await call('preview-account-profile', {})).value
  const saved = await call('save-account-profile', { ticket: confirmed.ticket })
  assert.deepEqual(saved, { status: 200, value: {
    name: '测试昵称', avatarUrl: 'https://platform.deepseek.com/fake-avatar.png', source: 'deepseek'
  } })
  handler.signedOut()
  assert.deepEqual((await call('state')).value.profile, { name: '本机备注', avatarUrl: '', source: 'manual' })
})

test('selecting chat context includes only selected messages and opt-in file bytes', async t => {
  const lab = await setup(t)
  const file = Buffer.from('chosen data')
  const skipped = await lab.bob.send('alice', 'private unrelated text')
  const selected = await lab.bob.send('alice', 'selected text')
  const material = await lab.bob.sendBundle('alice', {
    submission: randomBytes(16).toString('hex'), reply: 'selected response', name: 'chosen.txt',
    size: file.length, sha256: hash(file), data: file.toString('base64url')
  })
  await lab.alice.sync()
  const context = await lab.alice.selectedContext('bob', [material.id, selected.id], false)
  assert.equal(context.prompt.includes('private unrelated text'), false)
  assert.ok(context.prompt.indexOf('selected text') < context.prompt.indexOf('selected response'))
  assert.deepEqual(context.files, [])
  assert.deepEqual((await lab.alice.selectedContext('bob', [material.id], true)).files, [{ name: 'chosen.txt', data: file.toString('base64url') }])
  await assert.rejects(lab.alice.selectedContext('carol', [skipped.id], true), /不属于/)
  await assert.rejects(lab.alice.selectedContext('bob', [selected.id, selected.id], false), /请选择/)
})

test('invitation links round-trip without private keys and reject changed origins and missing fingerprint approval', async t => {
  const lab = await setup(t, { paired: false })
  const invite = lab.bob.invitation()
  const shared = shareInvitation(invite, 'https://relay.example.test')
  const parsed = await readSharedInvitation(shared.link)
  assert.deepEqual(parsed, { code: invite.code, fingerprint: invite.fingerprint, relay: 'https://relay.example.test' })
  assert.equal((await readSharedInvitation(invite.code)).relay, null)
  assert.match(shared.qr, /^data:image\/gif;base64,/)
  const payload = JSON.parse(Buffer.from(new URL(shared.link).hash.slice(10), 'base64url').toString('utf8'))
  assert.deepEqual(Object.keys(payload).sort(), ['code', 'relay', 'v'])
  await assert.rejects(readSharedInvitation(shared.link.replace('github.com', 'example.test')), /无效/)
  await assert.rejects(readSharedInvitation(shared.link + '&tracking=1'), /无效/)
  const invalid = new URL(shared.link)
  invalid.hash = 'deepchat=' + Buffer.from(JSON.stringify({ ...payload, relay: 'http://public.example.test' })).toString('base64url')
  await assert.rejects(readSharedInvitation(invalid.href), /无效/)

  const handler = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: { request: lab.request } })
  const requestFriend = code => handler(new Request('http://127.0.0.1/api/private-chat/submit', {
    method: 'POST', headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'request-friend', alias: 'bob', code, fingerprint: invite.fingerprint })
  }))
  const mismatched = await requestFriend(shared.link)
  assert.equal(mismatched.status, 400)
  assert.match((await mismatched.json()).error, /先连接/)
  assert.equal((await requestFriend(shareInvitation(invite, 'http://127.0.0.1:8611').link)).status, 200)
  await assert.rejects(lab.bob.requestFriend('alice', lab.alice.invitation().code, 'wrong'), /fingerprint/)
})

test('first-run local relay registers once, delivers a friend request and messages, then restarts with the same identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-onboarding-'))
  const options = { localPort: 0 }
  let stop
  let bob
  t.after(async () => {
    await stop?.()
    bob?.close()
    await rm(root, { recursive: true, force: true })
  })
  let handler = createHandler({ directory: join(root, 'alice'), deviceOptions: options, pollMs: 15 })
  stop = handler.start()
  const call = async (action, input) => {
    const response = await handler(new Request('http://127.0.0.1/api/private-chat' + (input ? '/submit' : '?action=' + action), {
      method: input ? 'POST' : 'GET',
      headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
      body: input && JSON.stringify({ action, ...input })
    }))
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result
  }
  assert.equal((await call('overview')).ready, false)
  const [registered, repeated] = await Promise.all([call('start-local-relay', {}), call('start-local-relay', {})])
  assert.equal(registered.code, repeated.code)
  assert.equal(registered.relay.localRunning, true)
  options.localPort = Number(new URL(registered.relay.origin).port)
  await initializeDevice(join(root, 'bob'))
  bob = openDevice(join(root, 'bob'), { relay: registered.relay.origin })
  await bob.register()
  const aliceInvite = await call('share-invite', {})
  assert.equal((await call('read-invite', { value: aliceInvite.link })).code, registered.code)
  await bob.requestFriend('alice', aliceInvite.code, aliceInvite.fingerprint)
  await call('sync', {})
  const incoming = (await call('state')).requests.find(request => request.direction === 'in')
  await call('decide-friend', { id: incoming.id, decision: 'accepted', alias: 'bob', fingerprint: incoming.fingerprint })
  await bob.sync()
  assert.equal((await call('send', { alias: 'bob', text: '本机试用首条消息' })).status, 'stored')
  await bob.sync()
  assert.equal((await bob.history()).at(-1).text, '本机试用首条消息')
  await call('sync', {})
  await stop()
  handler = createHandler({ directory: join(root, 'alice'), deviceOptions: options, pollMs: 15 })
  stop = handler.start()
  for (let attempt = 0; attempt < 40 && !(await call('overview')).relay.localRunning; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal((await call('overview')).relay.localRunning, true)
  assert.equal((await call('share-invite', {})).code, registered.code)
  await bob.send('alice', '重启后收到的消息')
  await call('sync', {})
  assert.equal((await call('state')).conversations[0].preview, '重启后收到的消息')
  assert.equal((await call('stop-local-relay', {})).stopped, true)
  assert.equal((await call('overview')).relay.localRunning, false)
  assert.equal((await call('overview')).relay.localEnabled, false)
  await stop()
  handler = createHandler({ directory: join(root, 'alice'), deviceOptions: options, pollMs: 15 })
  stop = handler.start()
  assert.equal((await call('overview')).relay.localRunning, false)
})

test('local relay port conflicts keep the existing relay and device settings intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-conflict-'))
  const occupied = await startLocalRelay(join(root, 'existing'), 0)
  const handler = createHandler({ directory: join(root, 'new-device'),
    deviceOptions: { localPort: Number(new URL(occupied.origin).port) } })
  t.after(async () => { await occupied.close(); await rm(root, { recursive: true, force: true }) })
  const response = await handler(new Request('http://127.0.0.1/api/private-chat/submit', {
    method: 'POST', headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start-local-relay' })
  }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /端口已占用/)
  const overview = await handler(new Request('http://127.0.0.1/api/private-chat?action=overview',
    { headers: { 'x-dsh-private-chat': '1' } }))
  assert.equal((await overview.json()).ready, false)
  assert.equal((await fetch(occupied.origin + '/v1/mailboxes/' + '0'.repeat(64))).status, 401)
})

test('local search scans encrypted history across pages and opens only the selected contact context', async t => {
  const lab = await setup(t)
  const sent = []
  for (let i = 0; i < 105; i++) sent.push(await lab.alice.send('bob', `${i === 0 || i === 104 ? '独特检索 Cafe\u0301' : 'ordinary'} ${i}`))
  const first = await lab.alice.searchConversation('bob', 'CAFÉ')
  assert.equal(first.scanned, 100)
  assert.deepEqual(first.messages.map(item => item.id), [sent[104].id])
  assert.equal(first.before, 6)
  const second = await lab.alice.searchConversation('bob', 'café', first.before)
  assert.equal(second.scanned, 5)
  assert.equal(second.before, null)
  assert.deepEqual(second.messages.map(item => item.id), [sent[0].id])
  const context = await lab.alice.conversationContext('bob', sent[30].id)
  assert.equal(context.focus, sent[30].id)
  assert.equal(context.messages.length, 41)
  assert.deepEqual(context.messages.map(item => item.id), sent.slice(10, 51).map(item => item.id))
  assert.equal(context.messages[20].position, 31)
  assert.equal((await lab.alice.conversationContext('bob', sent[0].id)).messages.length, 21)
  await initializeDevice(join(lab.root, 'charlie'))
  const charlie = lab.connect('charlie')
  const invite = charlie.invitation()
  await lab.alice.trust('charlie', invite.code, invite.fingerprint)
  assert.equal((await lab.alice.searchConversation('charlie', '独特检索')).messages.length, 0)
  await assert.rejects(lab.alice.conversationContext('charlie', sent[30].id), /不属于/)
  await assert.rejects(lab.alice.searchConversation('bob', ' '), /搜索内容/)
  await assert.rejects(lab.alice.searchConversation('bob', 'a'.repeat(129)), /搜索内容/)
  await assert.rejects(lab.alice.searchConversation('bob', 'a', -1), /会话/)
  await assert.rejects(lab.alice.searchConversation('missing', 'a'), /会话/)
  const handler = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: {
    request() { throw new Error('Search must not contact the relay') }
  } })
  async function call(action, input, origin) {
    return handler(new Request('http://127.0.0.1/api/private-chat/submit', {
      method: 'POST', headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ action, ...input })
    }))
  }
  const search = await call('search-conversation', { alias: 'bob', query: '独特检索' })
  assert.equal(search.status, 200)
  assert.equal((await search.json()).messages.length, 1)
  assert.equal((await call('search-conversation', { alias: 'bob', query: '独特检索' }, 'https://example.com')).status, 403)
  assert.equal((await call('conversation-context', { alias: 'charlie', id: sent[0].id })).status, 400)
  const selected = await lab.alice.selectedContext('bob', [context.focus], false)
  assert.match(selected.prompt, /ordinary 30/)
  assert.doesNotMatch(selected.prompt, /ordinary 29/)
  lab.disconnect(lab.alice)
  assert.equal((await readFile(join(lab.root, 'alice/device.sqlite'))).includes(Buffer.from('独特检索')), false)
})

test('quoted replies use the local original, preserve old text delivery and reject another contact or an oversized reply', async t => {
  const lab = await setup(t)
  const original = await lab.bob.send('alice', '第一行\n第二行 😀')
  await lab.alice.sync()
  const replied = await lab.alice.send('bob', '我的回复', original.id)
  await lab.bob.sync()
  const received = (await lab.bob.history()).find(item => item.id === replied.id)
  assert.equal(received.text, '引用 bob：\n> 第一行\n> 第二行 😀\n\n我的回复')
  await initializeDevice(join(lab.root, 'charlie'))
  const charlie = lab.connect('charlie')
  const invite = charlie.invitation()
  await lab.alice.trust('charlie', invite.code, invite.fingerprint)
  await assert.rejects(lab.alice.send('charlie', '不能串会话', original.id), /不属于/)
  await assert.rejects(lab.alice.send('bob', '不存在的引用', '0'.repeat(32)), /不属于/)
  await assert.rejects(lab.alice.send('bob', 'a'.repeat(maxTextBytes), original.id), /8192/)
  const long = await lab.bob.send('alice', '😀'.repeat(700))
  await lab.alice.sync()
  const truncated = await lab.alice.send('bob', '收到', long.id)
  await lab.bob.sync()
  assert.equal((await lab.bob.history()).find(item => item.id === truncated.id).text,
    `引用 bob：\n> ${'😀'.repeat(600)}…\n\n收到`)
})

test('local search finds attachment names without searching attachment bytes', async t => {
  const lab = await setup(t)
  const bytes = Buffer.from('HiddenFileBodyMarker')
  const sent = await lab.alice.sendBundle('bob', { reply: '材料回复', name: 'Project-Meeting.txt',
    data: bytes.toString('base64url'), size: bytes.length, sha256: hash(bytes), submission: 'a'.repeat(32) })
  assert.deepEqual((await lab.alice.searchConversation('bob', 'meeting')).messages.map(item => item.id), [sent.id])
  assert.equal((await lab.alice.searchConversation('bob', 'HiddenFileBodyMarker')).messages.length, 0)
})

test('encrypted backup restores identity, history, attachments and queued messages without overwriting a device', async t => {
  const lab = await setup(t)
  const { backupDevice, restoreDevice } = await import('../src/device-backup.js')
  const directory = join(lab.root, 'alice')
  const archive = join(lab.root, 'alice.deepchat')
  const recovered = join(lab.root, 'recovered')
  const password = 'synthetic backup passphrase'
  const identity = await readFile(join(directory, 'identity.json'))
  const bytes = Buffer.from('backup-test attachment')
  const attachment = await lab.alice.sendBundle('bob', { reply: '备份测试', name: 'test.txt',
    data: bytes.toString('base64url'), size: bytes.length, sha256: hash(bytes), submission: 'b'.repeat(32) })
  const offline = lab.connect('alice', () => { throw new Error('Offline') })
  const queued = await offline.send('bob', '备份保留待发送记录')
  assert.equal(queued.status, 'queued')
  const fromBefore = await lab.alice.history()
  await backupDevice(directory, archive, password)
  const encrypted = await readFile(archive)
  assert.equal(encrypted.includes(identity), false)
  await assert.rejects(backupDevice(directory, archive, password), { code: 'EEXIST' })
  assert.deepEqual(await readFile(archive), encrypted)
  await assert.rejects(restoreDevice(archive, recovered, 'incorrect passphrase'), /Incorrect passphrase/)
  const damaged = join(lab.root, 'damaged.deepchat')
  const { writeFile } = await import('node:fs/promises')
  encrypted[encrypted.length - 1] ^= 1
  await writeFile(damaged, encrypted)
  await assert.rejects(restoreDevice(damaged, recovered, password), /damaged backup/)
  await assert.rejects(restoreDevice(archive, directory, password), { code: 'EEXIST' })
  await restoreDevice(archive, recovered, password)
  assert.deepEqual(await readFile(join(recovered, 'identity.json')), identity)
  const device = lab.connect('recovered')
  assert.deepEqual(device.invitation(), lab.alice.invitation())
  assert.deepEqual(await device.history(), fromBefore)
  assert.deepEqual((await device.download(attachment.id)).bytes, bytes)
  await device.sync()
  await lab.bob.sync()
  assert.equal((await lab.bob.history()).at(-1).id, queued.id)
})

test('panel backup requires the local DSH origin and downloads an archive the CLI can restore', async t => {
  const lab = await setup(t)
  const sent = await lab.alice.send('bob', 'backup from local panel')
  const handler = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: {
    request() { throw new Error('Backup must not reach the relay') }
  } })
  const password = 'a local backup phrase'
  function exportBackup(origin, passphrase = password) {
    return handler(new Request('http://127.0.0.1/api/private-chat/submit', {
      method: 'POST', headers: { origin, 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'export-backup', password: passphrase })
    }))
  }
  assert.equal((await exportBackup('https://example.com')).status, 403)
  assert.equal((await exportBackup('http://127.0.0.1', 'short')).status, 400)
  const started = exportBackup('http://127.0.0.1')
  assert.equal((await exportBackup('http://127.0.0.1')).status, 409)
  const response = await started
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="dsh-DeepChat-\d{4}-\d{2}-\d{2}\.deepchat"$/)
  const archive = join(lab.root, 'panel.deepchat')
  const { writeFile } = await import('node:fs/promises')
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    join(lab.root, 'restored'), 'restore', archive], { input: password, encoding: 'utf8', timeout: 10_000 })
  assert.equal(result.status, 0, result.stderr)
  const restored = lab.connect('restored')
  assert.deepEqual(restored.invitation(), lab.alice.invitation())
  assert.equal((await restored.history())[0].id, sent.id)
})

test('a local file sends without a DSH session and retains its caption, bytes and delivery receipt', async t => {
  const lab = await setup(t)
  const handler = createHandler({ directory: join(lab.root, 'alice'), deviceOptions: { request: lab.request } })
  const bytes = randomBytes(maxFileBytes)
  const file = { alias: 'bob', name: 'local-notes.txt', size: bytes.length, data: bytes.toString('base64url'),
    sha256: hash(bytes), submission: 'a'.repeat(32), caption: '' }
  const sendFile = input => handler(new Request('http://127.0.0.1/api/private-chat/submit', {
    method: 'POST', headers: { 'x-dsh-private-chat': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'send-file', ...file, ...input })
  }))
  assert.equal((await sendFile({ caption: null })).status, 400)
  assert.equal((await sendFile({ sha256: '0'.repeat(64) })).status, 400)
  const sent = await sendFile({})
  assert.equal(sent.status, 200)
  const { id } = await sent.json()
  assert.equal((await (await sendFile({})).json()).id, id)
  const described = await sendFile({ caption: '  请看本地附件  ' })
  assert.equal(described.status, 200)
  const describedId = (await described.json()).id
  await lab.bob.sync()
  await lab.alice.sync()
  const history = await lab.bob.history()
  assert.deepEqual(history.map(item => [item.id, item.text]), [[id, '分享了一个文件'], [describedId, '请看本地附件']])
  assert.deepEqual((await lab.bob.download(id)).bytes, bytes)
  assert.equal((await lab.alice.history())[0].status, 'delivered')
  const context = await lab.bob.selectedContext('alice', [describedId], true)
  assert.match(context.prompt, /请看本地附件/)
  assert.deepEqual(context.files, [{ name: file.name, data: file.data }])
})
