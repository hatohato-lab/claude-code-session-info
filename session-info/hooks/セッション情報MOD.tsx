// セッション情報MOD の入口。読み込んだときの動きと、各部品のつなぎだけを書く
// 部品\表を描く.tsx    表、g のボタン、行ごとの入力ボックス
// 部品\数字を集める.ts  2秒ごとに セッション表.py を回す
// 部品\文を送る.ts      g と、入力ボックスに打った文を送る
// 部品\共通.ts          部品のあいだで分け合う決まり
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { COMMAND, PANE, TITLE, live } from './部品/共通'
import { EVERY_MS, tick } from './部品/数字を集める'
import { drawPane } from './部品/表を描く'

// ペインを開いておきたいか。手で閉じたときだけ false にする（読み直しをまたいで残る）
const paneWanted = atom({ plugin: 'session-info', key: 'paneWanted' } as const, true)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      live.selfId = await $.session.id()
    } catch {
      live.selfId = ''
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'セッション情報の表のペインを開く（いま開いている全セッションの名前・状態・圧縮回数・ログの大きさ）',
        immediate: true,
      })
    } catch {
      // 同じ名前のコマンドがあるときは登録しない
    }
    // 手で閉じていなければ、読み込んだときに自分から開く
    if ((await read($, paneWanted)) !== false) {
      live.isPaneOpen = true
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
      void tick($)
    }
    $.clock.every(EVERY_MS, () => {
      if (live.isPaneOpen) void tick($)
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    live.isPaneOpen = true
    await update($, paneWanted, () => true)
    // 前に出す指定（focus）を付ける。付けないと、ほかの mod のペインの後ろのタブに開いたままになる
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    void tick($)
    if (!opened.isPlaced) return { text: 'セッション情報のペインを置けませんでした: ' + opened.reason }
    return {}
  })

  // 開いておきたいのに置かれていないペインは、使っている人の入力のついでに開き直す
  on('prompt.submit', async ($, e, next) => {
    if (live.isPaneOpen) {
      const panes = await $.ui.panes()
      const mine = panes.find(pane => pane.id === PANE)
      if (mine === undefined || !mine.isPlaced) await $.ui.open({ id: PANE, title: TITLE })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    live.isPaneOpen = false
    // 手で閉じたときだけ「開かない」を覚える。読み直しで閉じたときは、次の読み込みで開き直す
    if (e.origin.kind === 'person') await update($, paneWanted, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))
}
