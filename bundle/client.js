window.__ModuleLoader__.load({
  id: 'dsh-task-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/plugins/dsh-task-notify/api'

    /** 与 Host 侧 COPY 对齐的界面文案；不依赖 Client locale 服务，插件可独立工作。 */
    const TEXT = {
      zh: {
        tab: '任务通知',
        intro: '任务结束或等待审批时，从 Windows 右下角弹出提醒。DSH 窗口最小化时同样生效。',
        mute: '全部静音',
        muteHint: '临时停掉所有弹窗，不改变下面的其他设置。',
        duration: '停留时长',
        durationHint: '鼠标悬停会暂停倒计时。',
        volume: '提示音量',
        volumeHint: '0 为静音，100 为系统音量。',
        sound: '播放提示音',
        soundHint: '完成与失败用系统通知音；待审批用更轻的提示音。',
        subagents: '子任务也提醒',
        subagentsHint: '默认关闭，避免并行子任务刷屏。',
        theme: '外观',
        themeSystem: '跟随系统',
        themeLight: '浅色',
        themeDark: '深色',
        test: '试弹一次',
        testDone: '完成',
        testFailed: '失败',
        testApproval: '待审批',
        status: '运行状态',
        shown: '已弹出',
        live: '正在显示',
        platform: '平台',
        script: '渲染脚本',
        recent: '最近事件',
        empty: '还没有事件。点上面的按钮试一次。',
        saveFailed: '保存失败',
        unavailable: 'Host 未就绪，稍后重试。',
        seconds: '秒',
      },
      en: {
        tab: 'Task Notifications',
        intro: 'A bottom-right Windows toast when a task ends or waits for approval — including while the DSH window is minimized.',
        mute: 'Mute all',
        muteHint: 'Stops every toast without changing the settings below.',
        duration: 'On-screen time',
        durationHint: 'Hovering the toast pauses the countdown.',
        volume: 'Alert volume',
        volumeHint: '0 is silent, 100 matches the system volume.',
        sound: 'Play alert sound',
        soundHint: 'Completion and failure use the system notification sound; approvals use a lighter one.',
        subagents: 'Notify for subagents',
        subagentsHint: 'Off by default so parallel subagents do not flood the corner.',
        theme: 'Appearance',
        themeSystem: 'Follow system',
        themeLight: 'Light',
        themeDark: 'Dark',
        test: 'Test toast',
        testDone: 'Done',
        testFailed: 'Failed',
        testApproval: 'Approval',
        status: 'Status',
        shown: 'Shown',
        live: 'On screen',
        platform: 'Platform',
        script: 'Render script',
        recent: 'Recent events',
        empty: 'No events yet. Use a test button above.',
        saveFailed: 'Save failed',
        unavailable: 'Host is not ready; retry in a moment.',
        seconds: 's',
      },
    }

    const pick = () => (String(navigator.language || '').toLowerCase().startsWith('en') ? TEXT.en : TEXT.zh)

    /* ── 样式：只引用宿主主题 token，不写死颜色 ── */
    const CSS = `
.tn-root { display: flex; flex-direction: column; gap: 22px; padding: 4px 2px 28px; color: var(--dsw-alias-label-primary); }
.tn-lede { margin: 0; max-width: 62ch; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.tn-group { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.tn-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 13px 0; }
.tn-row + .tn-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.tn-label { font-size: 13.5px; font-weight: 500; line-height: 1.5; }
.tn-hint { margin-top: 3px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.tn-control { display: flex; align-items: center; gap: 10px; }
.tn-switch { position: relative; width: 38px; height: 22px; border-radius: 999px; border: 0; padding: 0; cursor: pointer; background: var(--dsw-alias-border-l2); transition: background 140ms ease; }
.tn-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.tn-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 140ms ease; }
.tn-switch[aria-checked="true"]::after { transform: translateX(16px); }
.tn-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.tn-range { width: 168px; accent-color: var(--dsw-alias-brand-primary); }
.tn-value { min-width: 52px; text-align: right; font: 500 12px/1 "Cascadia Mono", Consolas, monospace; color: var(--dsw-alias-label-secondary); }
.tn-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
.tn-seg button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 500 12px/1 inherit; padding: 6px 11px; border-radius: 6px; cursor: pointer; }
.tn-seg button[aria-pressed="true"] { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.tn-tests { display: flex; flex-wrap: wrap; gap: 8px; }
.tn-btn { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font: 500 12.5px/1 inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
.tn-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tn-btn:disabled { opacity: 0.5; cursor: default; }
.tn-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.tn-stat { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.tn-stat b { display: block; font: 600 17px/1.3 inherit; }
.tn-stat span { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tn-log { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; padding-right: 4px; }
.tn-log-row { display: grid; grid-template-columns: 58px 76px minmax(0, 1fr); gap: 10px; align-items: baseline; font-size: 12px; line-height: 1.5; }
.tn-log-time { font: 500 11px/1.5 "Cascadia Mono", Consolas, monospace; color: var(--dsw-alias-label-secondary); }
.tn-log-kind { font: 600 10.5px/1.5 "Cascadia Mono", Consolas, monospace; letter-spacing: 0.04em; text-transform: uppercase; }
.tn-log-kind[data-kind="done"] { color: var(--dsw-alias-state-success-primary); }
.tn-log-kind[data-kind="failed"] { color: var(--dsw-alias-state-error-primary); }
.tn-log-kind[data-kind="approval"] { color: var(--dsw-alias-state-warn-primary); }
.tn-log-kind[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.tn-log-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.tn-error { color: var(--dsw-alias-state-error-primary); font-size: 12.5px; }
`

    function Switch({ checked, onChange, label }) {
      return h('button', {
        type: 'button', className: 'tn-switch', role: 'switch',
        'aria-checked': checked ? 'true' : 'false', 'aria-label': label,
        onClick: () => onChange(!checked),
      })
    }

    function Row({ label, hint, children }) {
      return h('div', { className: 'tn-row' },
        h('div', null,
          h('div', { className: 'tn-label' }, label),
          hint ? h('div', { className: 'tn-hint' }, hint) : null),
        h('div', { className: 'tn-control' }, children))
    }

    function clock(at) {
      const date = new Date(at)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    function Panel() {
      const t = pick()
      const [state, setState] = React.useState(null)
      const [failure, setFailure] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const read = React.useCallback(async () => {
        try {
          const response = await fetch(API, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const next = await response.json()
          setState(next)
          setFailure('')
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }, [])

      React.useEffect(() => {
        read()
        const id = setInterval(read, 3000)
        return () => clearInterval(id)
      }, [read])

      const save = React.useCallback(async (patch) => {
        setState((previous) => (previous === null ? previous : { ...previous, settings: { ...previous.settings, ...patch } }))
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'save', settings: patch }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const next = await response.json()
          setState((previous) => (previous === null ? previous : { ...previous, settings: next.settings }))
          setFailure('')
        } catch (error) {
          setFailure(`${t.saveFailed}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, [t])

      const test = React.useCallback(async (kind) => {
        setBusy(true)
        try {
          await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'test', state: kind }),
          })
          setTimeout(read, 400)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }, [read])

      if (state === null) {
        return h('div', { className: 'tn-root' },
          h('p', { className: 'tn-lede' }, t.intro),
          failure !== '' ? h('p', { className: 'tn-error' }, failure) : h('p', { className: 'tn-hint' }, t.unavailable))
      }

      const s = state.settings
      const events = state.events ?? []

      return h('div', { className: 'tn-root' },
        h('p', { className: 'tn-lede' }, t.intro),

        h('div', { className: 'tn-group' },
          h(Row, { label: t.mute, hint: t.muteHint },
            h(Switch, { checked: s.mute, label: t.mute, onChange: (value) => save({ mute: value }) })),

          h(Row, { label: t.duration, hint: t.durationHint },
            h('input', {
              className: 'tn-range', type: 'range', min: 2, max: 30, step: 1,
              value: Math.round(s.durationMs / 1000), 'aria-label': t.duration,
              onChange: (event) => save({ durationMs: Number(event.target.value) * 1000 }),
            }),
            h('span', { className: 'tn-value' }, `${Math.round(s.durationMs / 1000)} ${t.seconds}`)),

          h(Row, { label: t.volume, hint: t.volumeHint },
            h('input', {
              className: 'tn-range', type: 'range', min: 0, max: 100, step: 5,
              value: s.soundVolume, 'aria-label': t.volume,
              onChange: (event) => save({ soundVolume: Number(event.target.value) }),
            }),
            h('span', { className: 'tn-value' }, `${s.soundVolume}%`)),

          h(Row, { label: t.sound, hint: t.soundHint },
            h(Switch, { checked: s.sound, label: t.sound, onChange: (value) => save({ sound: value }) })),

          h(Row, { label: t.subagents, hint: t.subagentsHint },
            h(Switch, { checked: s.notifySubagents, label: t.subagents, onChange: (value) => save({ notifySubagents: value }) })),

          h(Row, { label: t.theme },
            h('div', { className: 'tn-seg' },
              [['system', t.themeSystem], ['light', t.themeLight], ['dark', t.themeDark]].map(([value, label]) =>
                h('button', {
                  key: value, type: 'button',
                  'aria-pressed': s.theme === value ? 'true' : 'false',
                  onClick: () => save({ theme: value }),
                }, label)))),

          h(Row, { label: t.test },
            h('div', { className: 'tn-tests' },
              h('button', { type: 'button', className: 'tn-btn', disabled: busy, onClick: () => test('done') }, t.testDone),
              h('button', { type: 'button', className: 'tn-btn', disabled: busy, onClick: () => test('failed') }, t.testFailed),
              h('button', { type: 'button', className: 'tn-btn', disabled: busy, onClick: () => test('approval') }, t.testApproval)))),

        failure !== '' ? h('p', { className: 'tn-error' }, failure) : null,

        h('div', { className: 'tn-stats' },
          h('div', { className: 'tn-stat' }, h('b', null, String(state.shown)), h('span', null, t.shown)),
          h('div', { className: 'tn-stat' }, h('b', null, String(state.live)), h('span', null, t.live)),
          h('div', { className: 'tn-stat' }, h('b', null, state.theme === 'dark' ? t.themeDark : t.themeLight), h('span', null, t.theme)),
          h('div', { className: 'tn-stat' }, h('b', null, state.platform), h('span', null, t.platform))),

        h('div', { className: 'tn-group' },
          h('div', { className: 'tn-label' }, t.recent),
          events.length === 0
            ? h('p', { className: 'tn-hint' }, t.empty)
            : h('div', { className: 'tn-log' }, events.map((entry, index) =>
                h('div', { className: 'tn-log-row', key: `${entry.at}-${index}` },
                  h('span', { className: 'tn-log-time' }, clock(entry.at)),
                  h('span', { className: 'tn-log-kind', 'data-kind': entry.state ?? entry.kind },
                    entry.state ?? entry.kind),
                  h('span', { className: 'tn-log-text' },
                    entry.title !== undefined
                      ? `${entry.title} · ${entry.body ?? ''}${entry.ms ? ` · ${entry.ms} ms` : ''}`
                      : String(entry.message ?? '')))))))
    }

    return {
      // locale 是硬依赖：apply 里要调 ctx.locale.register，缺了会在注册期抛错，
      // 整个 slot 条目被宿主丢弃，面板就永远不出现。
      // uiWorkspace 用来执行真正的会话跳转，缺了通知仍然弹，只是点了不跳。
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('settings.task-notify', { zh: TEXT.zh, en: TEXT.en }), 'task-notify: panel copy')

        // 样式以组件内 <style> 的形式随挂载插入、卸载移除，不依赖 styles 种子模块。
        const styleTag = () => h('style', { 'data-dsh-task-notify': '' }, CSS)
        const Wrapped = () => h(React.Fragment, null, h(styleTag), h(Panel))

        const label = () => pick().tab
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'task-notify',
          order: 20,
          label,
        }, Wrapped))

        // SSE delivers clicks immediately, including while the window is hidden.
        // The host replays an unacknowledged request when the page reconnects.
        let stopped = false
        let lastSeq = 0
        let chain = Promise.resolve()
        const stream = new EventSource(`${API}?stream=navigation`, { withCredentials: true })
        stream.onmessage = (event) => {
          chain = chain.catch(() => undefined).then(async () => {
            if (stopped) return
            const navigation = JSON.parse(event.data)
            if (!navigation || typeof navigation.seq !== 'number' || navigation.seq === lastSeq) return
            if (typeof navigation.sessionId !== 'string' || !navigation.sessionId) return
            const workspace = ctx.get('uiWorkspace')
            if (typeof workspace?.openSession !== 'function') throw new Error('Workspace unavailable')
            await workspace.openSession(navigation.sessionId)
            lastSeq = navigation.seq
            const response = await fetch(API, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'navigation-consumed', seq: navigation.seq }),
            })
            if (!response.ok) throw new Error(`Navigation acknowledgement: ${response.status}`)
          }).catch((error) => {
            console.warn('[task-notify] Navigation failed', error)
            // EventSource reconnects automatically after transport failures.
          })
        }
        ctx.effect(() => () => { stopped = true; stream.close() }, 'task-notify: navigation stream')
      },
    }
  },
})
