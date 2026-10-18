// ペインの中身を描く。1セッション＝1行の表で、見出しの行を付ける
// 列は左から、チームの線、チームの ■、名前、状態、進める（g）、送る文（入力ボックス）、メッセージ（最後の報告の要約）
// 10/18、2行や4行のカードにすると分かりづらいとの指示で1行の表に戻した。メッセージは指示で一番右に置き、字を小さくした
// チーム（名前の数字を除いた部分が同じセッションが2つ以上）は続けて並べ、左に同じ色の線と ■ を付ける。
// チームの中では、主（直近3時間にチームへ一番多く連絡を出したセッション）を先頭にし、ほかには「└」を付ける。
// チームの先頭の名前を押すと、そのチームの最近のやり取りが、チームの下に開く
// 返事を待っている行は薄い黄色、このセッションの行は薄い橙
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Inbox, SessionRow, Summary } from '../../types'
import { BLACK, BLUE, EMPTY, HEAD_FILL, RED, SELF_FILL, fitCells, live, normalize } from './共通'
import { askDetail, asksG, findAsk, pressG, readNote, sendText } from './文を送る'
import { messageOf } from './要約する'

const snapshot = atom({ plugin: 'session-info', key: 'snapshot' } as const, EMPTY)
const sendCount = atom({ plugin: 'session-info', key: 'sendCount' } as const, 0)
const sendNote = atom({ plugin: 'session-info', key: 'sendNote' } as const, '')
// やり取りを開いているチーム（チームの名前）
const openTeams = atom({ plugin: 'session-info', key: 'openTeams' } as const, [] as string[])
// AI の要約（メッセージの列に出す）
const summaries = atom({ plugin: 'session-info', key: 'summaries' } as const, {} as Record<string, Summary>)

// 列の幅（桁。全角1字は2桁）。メッセージの列は、ほかの列を置いた残りの幅を全部使い、1行に収める（入りきらない分は右端で「…」）
const NAME_CELLS = 14
const STATUS_CELLS = 4
const BUTTON_CELLS = 5
// 入力ボックスの幅。15桁では「送」が下に落ちて行が2段になったので、横に並ぶ24桁にした
const INPUT_CELLS = 24
// 詳しくのボタンの列（押すと、このチャットでその報告を詳しく説明する）
const DETAIL_CELLS = 6

// 状態は1文字で出す（10/18 の指示）。作＝作業中、待＝待機中、確＝確認待ち。ほかの値は頭の1文字
const STATUS_MARK: Record<string, string> = { 作業中: '作', 待機中: '待', 確認待ち: '確' }

// チームの色。チームごとに、左の線と ■ をこの色にする
const TEAM_COLORS = ['#2e7d32', '#1565c0', '#6a1b9a', '#ef6c00', '#00838f']
const NO_NAME = '（名前なし）'
// 返事を待っている行の色
const WAIT_FILL = '#fff3c4'
// 主を決めるときに数える連絡の範囲（直近3時間）と、開いたやり取りに出す件数
const LEAD_WINDOW_MS = 3 * 60 * 60 * 1000
const TALK_SHOWN = 8

function statusMark(status: string): string {
  return STATUS_MARK[status] ?? [...status][0] ?? '？'
}

function statusColor(mark: string): string | undefined {
  if (mark === '作') return BLUE
  if (mark === '確') return RED
  return undefined
}

// 私の返事を待っているか。確認待ちか、最後の答えで g を求めているか、「〜ですか」「〜ますか」と聞いている。
// 「次の指示をお願いします」のように、何も聞いていない待ち方は含めない
function isWaiting(row: SessionRow): boolean {
  if (row.status === '作業中') return false
  if (row.status === '確認待ち' || asksG(row)) return true
  return /ですか|ますか|[？?]/.test(findAsk(row.answer ?? ''))
}

// 名前の末尾の数字を除いた部分。2つ以上のセッションが同じなら、同じチーム（例：作業1・作業2・作業3 は「作業」）
function teamKey(name: string): string {
  return name === NO_NAME ? '' : name.replace(/[\s0-9０-９]+$/u, '').trim()
}

function isInbox(value: unknown): value is Inbox {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.from === 'string' && typeof item.text === 'string' && typeof item.at === 'number'
}

type Talk = { at: number; from: SessionRow; to: SessionRow; text: string }

// チームのやり取り（チームの中のセッションから、チームの中のセッションへ届いた連絡）。新しい順。within が数なら、その範囲だけ
function teamTalk(rows: SessionRow[], now: number, within: number | null): Talk[] {
  const byAddress = new Map<string, SessionRow>()
  for (const row of rows) if (row.address !== undefined && row.address !== '') byAddress.set(row.address, row)
  const talk: Talk[] = []
  for (const to of rows) {
    for (const item of to.inbox ?? []) {
      if (!isInbox(item)) continue
      const from = byAddress.get(item.from)
      if (from === undefined || from.id === to.id) continue
      if (within !== null && now - item.at > within) continue
      talk.push({ at: item.at, from, to, text: item.text })
    }
  }
  return talk.sort((a, b) => b.at - a.at)
}

// 主。直近3時間にチームへ一番多く連絡を出したセッション（同じ数なら、最後に出した方）。連絡が無ければ主は無い
function leaderOf(rows: SessionRow[], now: number): string | null {
  const counts = new Map<string, { n: number; last: number }>()
  for (const one of teamTalk(rows, now, LEAD_WINDOW_MS)) {
    const before = counts.get(one.from.id) ?? { n: 0, last: 0 }
    counts.set(one.from.id, { n: before.n + 1, last: Math.max(before.last, one.at) })
  }
  let best: string | null = null
  let bestN = 0
  let bestLast = 0
  for (const [id, c] of counts) {
    if (c.n > bestN || (c.n === bestN && c.last > bestLast)) {
      best = id
      bestN = c.n
      bestLast = c.last
    }
  }
  return best
}

type Group = { key: string; color: string | undefined; lead: string | null; rows: SessionRow[] }

// 並べ方。このセッションのチーム（チームが無ければこのセッションだけ）を一番上に置き、ほかのチームを続け、最後にチームの無いセッション。
// チームの中は、主、このセッション、返事を待っている行の順で、あとはセッション表.py の並び（名前の順）のまま
function arrange(rows: SessionRow[], self: string, now: number): Group[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = teamKey(row.name)
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const isTeam = (key: string) => key !== '' && (counts.get(key) ?? 0) >= 2
  const rank = (row: SessionRow) => (row.id === self ? 0 : isWaiting(row) ? 1 : 2)
  const selfRow = rows.find(row => row.id === self)
  const selfKey = selfRow === undefined ? '' : teamKey(selfRow.name)
  const teams = [...counts.keys()].filter(isTeam).sort((a, b) => (a === selfKey ? -1 : b === selfKey ? 1 : a.localeCompare(b)))
  const groups: Group[] = []
  const placed = new Set<string>()
  if (selfRow !== undefined && !isTeam(selfKey)) {
    groups.push({ key: '', color: undefined, lead: null, rows: [selfRow] })
    placed.add(selfRow.id)
  }
  teams.forEach((key, i) => {
    const members = rows.filter(row => teamKey(row.name) === key)
    const lead = leaderOf(members, now)
    const order = (row: SessionRow) => (row.id === lead ? -1 : rank(row))
    for (const row of members) placed.add(row.id)
    groups.push({ key, color: TEAM_COLORS[i % TEAM_COLORS.length], lead, rows: members.sort((a, b) => order(a) - order(b)) })
  })
  for (const row of rows.filter(one => !placed.has(one.id)).sort((a, b) => rank(a) - rank(b))) {
    groups.push({ key: '', color: undefined, lead: null, rows: [row] })
  }
  return groups
}

function hhmm(at: number): string {
  const d = new Date(at)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const table = $.ui.resolve(e)
  const { Box, Text, Button } = table
  // 入力ボックスは描ける画面でだけ出す
  const Input = 'Input' in table ? table.Input : undefined
  const snap = normalize(await read($, snapshot))
  const now = await $.clock.now()
  const groups = arrange(snap.rows, live.selfId, now)
  const storedCount = await read($, sendCount)
  const count = typeof storedCount === 'number' ? storedCount : 0
  const note = readNote(await read($, sendNote))
  const storedOpen = await read($, openTeams)
  const open = Array.isArray(storedOpen) ? storedOpen : []
  const storedSummaries = await read($, summaries)
  if (groups.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={snap.error === null ? undefined : RED}>{snap.error ?? 'セッションの情報を読み込んでいます'}</Text>
      </Box>
    )
  }

  const toggle = (key: string) =>
    update($, openTeams, list => {
      const current = Array.isArray(list) ? list : []
      return current.includes(key) ? current.filter(one => one !== key) : [...current, key]
    })

  const drawRow = (group: Group, row: SessionRow, index: number) => {
    const isSelf = row.id === live.selfId
    const textColor = isSelf ? BLACK : undefined
    const mark = statusMark(row.status)
    const color = statusColor(mark)
    const prefix = group.key === '' || group.lead === null ? '' : row.id === group.lead ? '主 ' : '└ '
    const label = fitCells(prefix + row.name, NAME_CELLS)
    return (
      <Box key={'row-' + row.id} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="stretch" backgroundColor={isSelf ? SELF_FILL : isWaiting(row) ? WAIT_FILL : undefined}>
        <Box key={row.id + '-bar'} width={1} flexShrink={0} backgroundColor={group.color}>
          <Text> </Text>
        </Box>
        <Box key={row.id + '-mark'} width={2} flexShrink={0} flexDirection="column" justifyContent="center">
          <Text color={group.color}>{group.color === undefined ? ' ' : '■'}</Text>
        </Box>
        <Box key={row.id + '-name'} width={NAME_CELLS} flexShrink={0} flexDirection="column" justifyContent="center">
          {group.key !== '' && index === 0 ? (
            <Button key={'team-' + group.key} plain onPress={() => void toggle(group.key)}>
              <Text color={textColor}>{label}</Text>
            </Button>
          ) : (
            <Text color={textColor}>{label}</Text>
          )}
        </Box>
        <Box key={row.id + '-status'} width={STATUS_CELLS} flexShrink={0} flexDirection="column" justifyContent="center" alignItems="center">
          <Text color={color ?? textColor} bold={color !== undefined}>{mark}</Text>
        </Box>
        <Box key={row.id + '-button'} width={BUTTON_CELLS} flexShrink={0} flexDirection="column" justifyContent="center" alignItems="center">
          {asksG(row) && <Button key={'g-' + row.id} label="g" onPress={() => void pressG($, row)} />}
        </Box>
        <Box key={row.id + '-input'} width={INPUT_CELLS} flexShrink={0}>
          {Input !== undefined && (
            <Input
              key={'input-' + row.id + '-' + String(count)}
              submitLabel="送"
              onSubmit={value => {
                void sendText($, row, value)
              }}
            />
          )}
        </Box>
        <Box key={row.id + '-detail'} width={DETAIL_CELLS} flexShrink={0} flexDirection="column" justifyContent="center" alignItems="center">
          <Button key={'detail-' + row.id} label="詳" onPress={() => void askDetail($, row)} />
        </Box>
        <Box key={row.id + '-message'} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" flexDirection="column" justifyContent="center">
          <Text color={textColor} size="caption" wrap="truncate-end">{messageOf(row, storedSummaries)}</Text>
        </Box>
      </Box>
    )
  }

  // チームの最近のやり取り（新しい順に8件まで）。時刻、送り主 → 受け手、本文の頭
  const drawTalk = (group: Group) => {
    const talk = teamTalk(group.rows, now, null).slice(0, TALK_SHOWN)
    return (
      <Box key={'talk-' + group.key} flexDirection="column" paddingLeft={4}>
        {talk.length === 0 ? (
          <Text color={BLACK} size="caption">このチームのやり取りは、まだありません</Text>
        ) : (
          talk.map((one, i) => (
            <Text key={'talk-' + group.key + '-' + String(i)} color={BLACK} size="caption" wrap="truncate-end">
              {hhmm(one.at) + '  ' + one.from.name + ' → ' + one.to.name + '  ' + one.text.replace(/\s+/g, ' ')}
            </Text>
          ))
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="nowrap" gap={1} backgroundColor={HEAD_FILL}>
        <Box key="head-bar" width={1} flexShrink={0}>
          <Text> </Text>
        </Box>
        <Box key="head-mark" width={2} flexShrink={0}>
          <Text> </Text>
        </Box>
        <Box key="head-name" width={NAME_CELLS} flexShrink={0}>
          <Text bold color={BLACK}>名前</Text>
        </Box>
        <Box key="head-status" width={STATUS_CELLS} flexShrink={0} justifyContent="center">
          <Text bold color={BLACK}>状態</Text>
        </Box>
        <Box key="head-button" width={BUTTON_CELLS} flexShrink={0} justifyContent="center">
          <Text bold color={BLACK}>進める</Text>
        </Box>
        <Box key="head-input" width={INPUT_CELLS} flexShrink={0}>
          <Text bold color={BLACK}>送る文</Text>
        </Box>
        <Box key="head-detail" width={DETAIL_CELLS} flexShrink={0} justifyContent="center">
          <Text bold color={BLACK}>詳しく</Text>
        </Box>
        <Box key="head-message" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text bold color={BLACK}>メッセージ</Text>
        </Box>
      </Box>
      {groups.map(group => (
        <Box key={'group-' + (group.key !== '' ? group.key : group.rows[0]?.id ?? '')} flexDirection="column">
          {group.rows.map((row, index) => drawRow(group, row, index))}
          {group.key !== '' && open.includes(group.key) && drawTalk(group)}
        </Box>
      ))}
      {snap.error !== null && <Text color={RED}>{snap.error}</Text>}
      {note !== null && <Text color={BLACK}>{note.text}</Text>}
    </Box>
  )
}
