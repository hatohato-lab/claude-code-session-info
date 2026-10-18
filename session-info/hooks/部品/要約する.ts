// 各セッションの最後の答えを、小さなモデル（haiku）で1文に要約する（10/18 の指示）。
// 答えが変わったセッションだけを、1回に1つずつ、3秒以上あけて呼ぶ。失敗したら、その答えでは呼び直さず、題名のまま出す
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SessionRow, Summary } from '../../types'

const summaries = atom({ plugin: 'session-info', key: 'summaries' } as const, {} as Record<string, Summary>)

const MODEL = 'haiku'
const SYSTEM = [
  'あなたは、ある Claude Code のセッションの AI が最後に書いた答えを読み、',
  'その AI がいま何をしていて、使っている人に何を求めているかを、日本語の1文（40字以内）にまとめる係です。',
  '前置き、敬語、記号、引用符は書かない。1文だけを返す。',
].join('\n')
const GAP_MS = 3000

let isBusy = false
let lastCall = 0

// 答えの短い指紋。同じ答えかどうかを見分ける
export function answerKey(answer: string): string {
  let h = 0
  for (let i = 0; i < answer.length; i++) h = (h * 31 + answer.charCodeAt(i)) | 0
  return String(answer.length) + ':' + (h >>> 0).toString(36)
}

// 表に出す要約。その答えの要約ができていればそれを、まだなら題名を返す
export function messageOf(row: SessionRow, stored: unknown): string {
  const map = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, Summary | undefined>
  const one = map[row.id]
  const answer = row.answer ?? ''
  if (one !== undefined && typeof one.text === 'string' && one.text !== '' && one.key === answerKey(answer)) return one.text
  return row.summary ?? ''
}

// 要約がまだの答えを1つだけ要約する
export async function summarizeNext($: EngineInterface, rows: SessionRow[]): Promise<void> {
  if (isBusy) return
  const now = await $.clock.now()
  if (now - lastCall < GAP_MS) return
  const stored = await read($, summaries)
  const map = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, Summary | undefined>
  const target = rows.find(row => (row.answer ?? '') !== '' && map[row.id]?.key !== answerKey(row.answer ?? ''))
  if (target === undefined) return
  const answer = target.answer ?? ''
  const key = answerKey(answer)
  isBusy = true
  lastCall = now
  let text = ''
  try {
    const prompt = '題名: ' + (target.summary ?? '') + '\n\n答えの終わり:\n' + answer
    const result = await $.model.complete({ model: MODEL, system: SYSTEM, prompt, maxTokens: 120, timeoutMs: 30000 })
    if (result.isAnswered) text = result.text.replace(/\s+/g, ' ').trim()
  } catch {
    text = ''
  } finally {
    isBusy = false
  }
  await update($, summaries, prev => ({ ...(typeof prev === 'object' && prev !== null ? prev : {}), [target.id]: { key, text } }))
}
