// 開くのボタン（10/18 の指示）。押したセッションのタブを、VS Code の一番前に出す。
// VS Code の Claude Code 拡張は、vscode://anthropic.claude-code/open?session=<セッションID> を開くと、
// そのセッションのタブがあれば前に出し、無ければ開く。この URL を、Windows の start で開く
import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SessionRow } from '../../types'

// 前に出せなかったときの1行（送った結果と同じ欄に出す。JSON で持つ）
const sendNote = atom({ plugin: 'session-info', key: 'sendNote' } as const, '')

export const OPEN_URL = 'vscode://anthropic.claude-code/open?session='

// VS Code のタブで動いているセッションか。ターミナルのセッションは、タブを前に出せないのでボタンを出さない
export function isTab(row: SessionRow): boolean {
  return row.entrypoint === 'claude-vscode'
}

export async function bringToFront($: EngineInterface, row: SessionRow): Promise<void> {
  let reason: string | null = null
  try {
    // start の最初の引数は窓の題名。空の題名を渡して、URL を題名と取り違えないようにする
    const ran = await $.process.run(['cmd', '/c', 'start', '', OPEN_URL + row.id], { timeoutMs: 10000 })
    if (ran.exitCode !== 0) reason = 'exit ' + ran.exitCode + (ran.stderr.trim() !== '' ? '、' + ran.stderr.trim().slice(0, 80) : '')
  } catch (error) {
    reason = String(error)
  }
  if (reason !== null) {
    await update($, sendNote, () => JSON.stringify({ id: row.id, text: row.name + ' のタブを前に出せませんでした（' + reason + '）' }))
  }
}
