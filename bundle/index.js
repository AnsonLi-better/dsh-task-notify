/**
 * Task notifications, Host half.
 *
 * Watches the durable session feed and raises one Windows toast per terminal
 * turn outcome or pending approval. The toast is a separate WPF process, so it
 * does not depend on the DSH window being visible, focused, or even minimized:
 * the Host process keeps running while the renderer is hidden.
 *
 * The debug/settings panel talks to this file over one loopback route
 * (`GET/POST /plugins/dsh-task-notify/api`), the same shape another installed
 * bundle uses for its status card.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

export const name = 'task-notify'
export const inject = ['subprocess']
const here = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = join(here, 'assets', 'toast.ps1')
const API_PATH = '/plugins/dsh-task-notify/api'
/** 与 web-app 的 LOOPBACK_HOST 一致：本机 GUI 只从回环地址服务。 */
const LOOPBACK = '127.0.0.1'

/** Only these turn outcomes deserve a toast; `forked` and user aborts do not. */
const NOTIFY_TURN_REASONS = new Set(['completed', 'error', 'max-tokens', 'interrupted'])

/** Everything the panel may change, plus what it needs to render. */
const DEFAULTS = {
  durationMs: 6000,
  maxVisible: 3,
  notifySubagents: false,
  sound: true,
  soundVolume: 35,
  mute: false,
  theme: 'system',
}

/** Localized copy for the three states. */
const COPY = {
  zh: {
    done: { title: '任务已完成', open: '打开会话', dismiss: '忽略' },
    failed: { title: '任务中断', open: '查看原因', dismiss: '忽略' },
    approval: { title: '等待你的确认', open: '立即处理', dismiss: '稍后' },
    tools: (n) => `${n} 次工具调用`,
    stopped: (reason) => `原因：${reason}`,
    approvalBody: (tool) => `${tool} 需要你批准后继续`,
  },
  en: {
    done: { title: 'Task completed', open: 'Open session', dismiss: 'Dismiss' },
    failed: { title: 'Task interrupted', open: 'See why', dismiss: 'Dismiss' },
    approval: { title: 'Waiting for your confirmation', open: 'Review', dismiss: 'Later' },
    tools: (n) => `${n} tool calls`,
    stopped: (reason) => `Reason: ${reason}`,
    approvalBody: (tool) => `${tool} needs your approval before it can continue`,
  },
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Pick a copy table from the OS UI language. */
function copyFor() {
  const tag = String(process.env.DSH_UI_LANG ?? '').toLowerCase()
  return tag.startsWith('en') ? COPY.en : COPY.zh
}

/** Clamp one numeric setting without trusting the caller. */
function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Read the Windows "apps use light theme" flag. */
function systemThemeIsDark() {
  return new Promise((resolve) => {
    try {
      execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { windowsHide: true, timeout: 1500 }, (error, stdout) => {
        if (error !== null) { resolve(false); return }
        resolve(/AppsUseLightTheme\s+REG_DWORD\s+0x0\b/i.test(String(stdout)))
      })
    } catch {
      resolve(false)
    }
  })
}

/** Strip a session title down to something a toast can show on one or two lines. */
function shortTitle(title) {
  if (typeof title !== 'string') return ''
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean.length <= 28) return clean
  return `${clean.slice(0, 27)}…`
}

/** Turn one turn/end reason into the toast state, or undefined to stay quiet. */
function stateOfTurnEnd(reason) {
  if (reason === undefined || reason === null) return undefined
  const kind = String(reason.kind ?? '')
  if (!NOTIFY_TURN_REASONS.has(kind)) return undefined
  return kind === 'completed' ? 'done' : 'failed'
}

/** Human reason for a failed turn, without leaking a stack trace. */
function reasonText(reason) {
  if (reason === undefined || reason === null) return 'unknown'
  if (reason.kind === 'error') {
    const failure = reason.error
    const message = typeof failure?.message === 'string' ? failure.message : ''
    const code = typeof failure?.code === 'string' ? failure.code : ''
    const text = message !== '' ? message : code !== '' ? code : 'model request failed'
    return text.length <= 60 ? text : `${text.slice(0, 59)}…`
  }
  if (reason.kind === 'max-tokens') return 'context limit reached'
  if (reason.kind === 'interrupted') return 'interrupted'
  return String(reason.kind)
}

/** Reject a request that did not come from this machine's own page. */
function rejected(req, res) {
  const host = String(req.headers?.host ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (!LOOPBACK_HOSTS.has(hostname)) {
    res.statusCode = 403
    res.end()
    return true
  }
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (!LOOPBACK_HOSTS.has(new URL(origin).hostname)) {
        res.statusCode = 403
        res.end()
        return true
      }
    } catch {
      res.statusCode = 403
      res.end()
      return true
    }
  }
  return false
}

/** Bounded JSON body read; the panel never sends more than a few hundred bytes. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 16 * 1024) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function apply(ctx, config) {
  const copy = copyFor()

  /** Live, panel-editable settings. Seeded from the patch row, then persisted to disk. */
  const settings = {
    durationMs: clamp(config?.durationMs, 1500, 60_000, DEFAULTS.durationMs),
    maxVisible: clamp(config?.maxVisible, 1, 5, DEFAULTS.maxVisible),
    notifySubagents: config?.notifySubagents === true,
    sound: config?.sound !== false,
    soundVolume: clamp(config?.soundVolume, 0, 100, DEFAULTS.soundVolume),
    mute: config?.mute === true,
    theme: ['light', 'dark', 'system'].includes(config?.theme) ? config.theme : DEFAULTS.theme,
  }

  /** Rolling event log the panel renders; bounded so it cannot grow without limit. */
  const events = []
  const MAX_EVENTS = 40
  const live = []
  let shown = 0
  let disposed = false
  let persistTimer

  const log = (entry) => {
    events.unshift({ at: Date.now(), ...entry })
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  }

  /** Persist through the profile's config editor so the value survives restart. */
  const persist = () => {
    if (persistTimer !== undefined) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      persistTimer = undefined
      try {
        const editor = ctx.get('configEditor')
        if (editor === undefined) return
        const entry = editor.entries().find((item) => item.id === 'task-notify')
        if (entry === undefined) return
        await editor.edit(entry, () => ({ ...settings }))
        log({ kind: 'settings', message: 'saved' })
      } catch (error) {
        log({ kind: 'error', message: `settings save failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    }, 400)
  }

  ctx.effect(() => () => {
    disposed = true
    if (persistTimer !== undefined) clearTimeout(persistTimer)
    for (const handle of live.splice(0)) {
      try { handle.terminate() } catch { /* already gone */ }
    }
  }, 'task-notify: live toasts')

  /**
   * 待跳转的 Session。
   *
   * 链路：toast 进程被点击 → POST /api {action:'navigate'} → 这里记下 sessionId
   * → 页面里的 Client 半边轮询 /api 拿到它 → 调 uiWorkspace.openSession()。
   *
   * 为什么要绕这一圈：桌面壳没有 session 深链（dsh://open 只做聚焦），
   * 前端是纯 SPA 无 URL 路由，而 toast 是独立进程碰不到页面 JS。
   * Host 和页面之间唯一的现成通道就是这条 loopback HTTP 路由。
   */
  let pendingNavigation
  const navigationStreams = new Set()
  const pushNavigation = (res) => res.write(`data: ${JSON.stringify(pendingNavigation ?? null)}\n\n`)
  ctx.effect(() => () => { for (const res of navigationStreams) res.end(); navigationStreams.clear() }, 'task-notify: close streams')
  let navigationSeq = 0
  /** 回调 token → 目标 sessionId。toast 进程点击时用 token 认领。 */
  const navigationTokens = new Map()

  const theme = async () => {
    if (settings.theme === 'dark') return 'dark'
    if (settings.theme === 'light') return 'light'
    return (await systemThemeIsDark()) ? 'dark' : 'light'
  }

  /**
   * 点击「打开会话」时要打开的地址。
   *
   * 关键事实（实测桌面壳 lib/main.js）：
   * - 桌面版只注册了 `dsh://open` 一个深链，且只做 `focusPrimaryWindow()`，
   *   不接受 session 参数；`dsh-app:` 是内部协议，外部进程打不开。
   * - 前端是纯 SPA 内存状态，没有 URL 路由，所以 `#/session/<id>` 这种锚点
   *   在桌面版里不会切到对应会话。
   *
   * 所以这里的目标退一步：**把 DSH 窗口叫到前台**，而不是精确跳转。
   * 用 `dsh://open`（桌面版注册过的协议）实现；没有该协议时退回打开
   * 带认证参数的页面 URL（浏览器/Web 版可用）。
   */
  let openTargetPromise
  const openTarget = async () => {
    if (openTargetPromise === undefined) {
      openTargetPromise = (async () => {
        try {
          const webServer = ctx.get('webServer')
          const connection = ctx.get('connection')
          if (webServer?.port === undefined) return undefined
          const raw = `http://${LOOPBACK}:${String(webServer.port)}`
          const authenticated = connection?.authenticatedUrl !== undefined
            ? await connection.authenticatedUrl(raw)
            : raw
          return typeof authenticated === 'string' && authenticated !== '' ? authenticated : undefined
        } catch {
          return undefined
        }
      })()
    }
    return openTargetPromise
  }

  /** Spawn one toast and keep at most `maxVisible` alive. */
  const show = async ({ state, title, body, primary, secondary, sessionId }) => {
    if (disposed || settings.mute) {
      log({ kind: 'skip', state, title, reason: settings.mute ? 'muted' : 'disposed' })
      return
    }

    const started = Date.now()
    let directory
    try {
      directory = await mkdtemp(join(tmpdir(), 'dsh-toast-'))
      const payloadFile = join(directory, 'payload.json')

      // 每条通知带一个自己的回调 token：点击时 toast 进程用它 POST 回来，
      // Host 据此知道要点开哪个 session。
      const token = `nav-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const base = await openTarget()
      if (sessionId !== undefined && base !== undefined) {
        navigationTokens.set(token, sessionId)
      }

      const payload = {
        state,
        theme: await theme(),
        title,
        body,
        primary,
        secondary,
        durationMs: settings.durationMs,
        sound: settings.sound,
        soundVolume: settings.soundVolume,
        // 有 sessionId 时走回调接口，页面里的 Client 半边会执行真正的跳转；
        // 没有就退化成打开 DSH 主页。
        navigateUrl: sessionId !== undefined && base !== undefined
          ? (() => {
              const url = new URL(base)
              url.pathname = API_PATH
              url.searchParams.set('navigate', token)
              url.hash = ''
              return url.href
            })()
          : undefined,
        openUrl: base,
      }
      const openUrlValue = typeof payload.openUrl === 'string' && payload.openUrl.startsWith('http') ? payload.openUrl : undefined
      payload.openUrl = openUrlValue
      await writeFile(payloadFile, JSON.stringify(payload), 'utf8')

      const executable = await ctx.subprocess.resolveExecutable('powershell.exe')
      const handle = ctx.subprocess.spawn({
        argv: [executable, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-PayloadFile', payloadFile],
        cwd: directory,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: { maxBytes: 8 * 1024 } },
        graceMs: 3000,
      })

      live.push(handle)
      while (live.length > settings.maxVisible) {
        const oldest = live.shift()
        try { oldest?.terminate() } catch { /* already gone */ }
      }

      const entry = {
        kind: 'toast',
        state,
        title,
        body,
        ms: 0,
        openable: openUrlValue !== undefined,
        navigable: sessionId !== undefined && navigationTokens.has(token),
      }
      log(entry)
      shown += 1

      handle.done
        .then((outcome) => {
          entry.ms = Date.now() - started
          entry.exit = outcome?.exitCode ?? null
          const index = live.indexOf(handle)
          if (index >= 0) live.splice(index, 1)
        })
        .catch((error) => {
          entry.ms = Date.now() - started
          entry.error = error instanceof Error ? error.message : String(error)
          const index = live.indexOf(handle)
          if (index >= 0) live.splice(index, 1)
        })
        .finally(async () => {
          await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        })
    } catch (error) {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      log({ kind: 'error', state, message: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Resolve the display title of a session without assuming the title service exists. */
  const titleOf = (session) => {
    try {
      const snapshot = ctx.get('sessionTitle')?.get(session)
      const title = shortTitle(snapshot?.title)
      if (title !== '') return title
    } catch { /* fall through */ }
    return ''
  }

  /**
   * The summary line for a finished turn.
   *
   * The model's last assistant message IS the completion summary — it just
   * wrote it for the user. Reuse it instead of calling a model again. Extract
   * the first text block, strip Markdown, and take the last non-empty line
   * (assistant turns usually open with a restatement and close with a result).
   */
  const summaryOf = (session) => {
    try {
      const events = session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type !== 'assistant/message') continue
        const blocks = event.data?.message?.content
        if (!Array.isArray(blocks)) continue
        // Last text block wins: later blocks follow tool interleaves.
        for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
          const block = blocks[blockIndex]
          if (block?.type !== 'text' || typeof block.text !== 'string') continue
          const lines = block.text
            .split(/\r?\n/)
            .map((line) => line
              .replace(/^#{1,6}\s+/, '')
              .replace(/^[-*+]\s+/, '')
              .replace(/^>\s?/, '')
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1')
              .trim())
            .filter((line) => line !== '')
          if (lines.length === 0) continue
          const summary = lines[lines.length - 1]
          if (summary.length <= 72) return summary
          return `${summary.slice(0, 71)}…`
        }
        // 这条 assistant 消息没有文本块（纯工具轮）——继续往回找，
        // 收尾总结在更早的、真正写给用户的 assistant 消息里。
      }
    } catch { /* a malformed log must never break the toast */ }
    return ''
  }

  /** One durable event at a time; the projection already proved it committed. */
  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'turn/end') return
      const isSubagent = session?.header?.origin === 'subagent'
      if (isSubagent && !settings.notifySubagents) return

      const state = stateOfTurnEnd(event.data?.reason)
      if (state === undefined) return

      const title = titleOf(session)
      const summary = summaryOf(session)
      // 只统计本轮 turn 的工具调用，不是全会话——用户关心的是"这次干了多少"。
      const turn = event.data?.turn
      const calls = session
        .snapshotEvents()
        .filter((item) => item.type === 'tool/call' && (turn === undefined || item.data?.turn === turn))
        .length
      const stats = copy.tools(calls)

      let body
      if (state === 'done') {
        // 标题 + 干了什么 + 规模；三段都短，塞得进两行。
        const parts = [title, summary, stats].filter((part) => part !== '')
        body = parts.join(' · ')
      } else {
        const reason = reasonText(event.data?.reason)
        const parts = [title, summary, copy.stopped(reason)].filter((part) => part !== '')
        body = parts.join(' · ')
      }

      void show({ state, title: copy[state].title, body, primary: copy[state].open, secondary: copy[state].dismiss, sessionId: session?.id })
    } catch (error) {
      log({ kind: 'error', message: `session/event: ${error instanceof Error ? error.message : String(error)}` })
    }
  })

  /** Approval requests are a waterfall: observe, never claim the decision. */
  ctx.on('approval/request', (req, next) => {
    try {
      if (req?.agent !== undefined) {
        const tool = typeof req.toolName === 'string' ? req.toolName : 'tool'
        const reason = typeof req.displayReason?.zh === 'string'
          ? req.displayReason.zh
          : typeof req.displayReason?.en === 'string' ? req.displayReason.en : ''
        const body = reason !== '' ? `${tool} · ${reason}` : copy.approvalBody(tool)
        void show({ state: 'approval', title: copy.approval.title, body, primary: copy.approval.open, secondary: copy.approval.dismiss, sessionId: req.agent?.id })
      }
    } catch (error) {
      log({ kind: 'error', message: `approval: ${error instanceof Error ? error.message : String(error)}` })
    }
    return next()
  })

  /** One loopback route: the panel's read of live state, and its writes. */
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: API_PATH,
      handler: async (req, res) => {
        if (rejected(req, res)) return
        try {
          // ── 通知点击的回跳：toast 进程带着自己的 token 打过来 ──
          // 用 GET 是为了能被 Start-Process 直接当 URL 打开（浏览器/壳会
          // 发一次 GET），不需要 toast 进程实现 HTTP 客户端。
          const requestUrl = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
          if (req.method === 'GET' && requestUrl.searchParams.get('stream') === 'navigation') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive' })
            navigationStreams.add(res)
            pushNavigation(res)
            const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
            res.on('close', () => { clearInterval(heartbeat); navigationStreams.delete(res) })
            return
          }
          const navigateToken = requestUrl.searchParams.get('navigate')
          if (navigateToken !== null) {
            const target = navigationTokens.get(navigateToken)
            if (target !== undefined) {
              navigationTokens.delete(navigateToken)
              pendingNavigation = { sessionId: target, seq: ++navigationSeq, at: Date.now() }
              for (const stream of navigationStreams) pushNavigation(stream)
              log({ kind: 'navigate', message: `queued ${target}` })
            }
            // 回一个极简页面：告诉用户已经切过去了，别停在白屏上。
            res.statusCode = 200
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(`<!doctype html><meta charset="utf-8"><title>DSH</title><body style="font:14px/1.6 system-ui;padding:32px;color:#444">正在切换到对应会话…<script>setTimeout(()=>{try{window.close()}catch(e){}},600)</script>`)
            return
          }

          if (req.method === 'GET') {
            sendJson(res, 200, {
              settings,
              shown,
              live: live.length,
              events: events.slice(0, 20),
              theme: await theme(),
              platform: process.platform,
              script: SCRIPT,
              // Client 半边轮询这个字段，拿到就执行跳转。
              navigation: pendingNavigation ?? null,
            })
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          const body = await readJson(req)
          const action = String(body.action ?? '')

          // Client 半边认领跳转后回报，Host 清掉它避免重复触发。
          if (action === 'navigation-consumed') {
            const seq = Number(body.seq)
            if (pendingNavigation != null && pendingNavigation.seq === seq) pendingNavigation = undefined
            sendJson(res, 200, { ok: true })
            return
          }

          if (action === 'save') {
            const patch = body.settings ?? {}
            if (patch.durationMs !== undefined) settings.durationMs = clamp(patch.durationMs, 1500, 60_000, settings.durationMs)
            if (patch.maxVisible !== undefined) settings.maxVisible = clamp(patch.maxVisible, 1, 5, settings.maxVisible)
            if (patch.soundVolume !== undefined) settings.soundVolume = clamp(patch.soundVolume, 0, 100, settings.soundVolume)
            if (patch.notifySubagents !== undefined) settings.notifySubagents = patch.notifySubagents === true
            if (patch.sound !== undefined) settings.sound = patch.sound !== false
            if (patch.mute !== undefined) settings.mute = patch.mute === true
            if (['light', 'dark', 'system'].includes(patch.theme)) settings.theme = patch.theme
            persist()
            sendJson(res, 200, { settings })
            return
          }
          if (action === 'test') {
            const state = ['done', 'failed', 'approval'].includes(body.state) ? body.state : 'done'
            const text = copy[state]
            // sessionId 可选：面板"试弹"带上它就能验证「打开会话」的完整跳转链路。
            await show({
              state,
              title: text.title,
              body: body.body ?? copy.tools(12),
              primary: text.open,
              secondary: text.dismiss,
              sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            })
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 400, { error: `unknown action: ${action}` })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'task-notify: panel api')  })
}
