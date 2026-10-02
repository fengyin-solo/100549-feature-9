import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BatchReceipt,
  BatchResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RainStationDraft,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 单向流转：声明了 oneWay 的模块，状态只能沿 statuses 的固定次序向前走，回退一律拒绝。
function canTransition(meta: ModuleMeta, from: string, to: string): boolean {
  if (!meta.oneWay) {
    return true
  }
  return meta.statuses.indexOf(to) > meta.statuses.indexOf(from)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (!canTransition(meta, current, target)) {
    return {
      ok: false,
      message: `${meta.entity}状态只能按「${meta.statuses.join('→')}」单向流转，不能由「${current}」改为「${target}」`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 雨量站网批量操作 ————————————————————————————————————————

// 同一站号重复提交时的字段优先级（写清，页面同步展示，改动要两边一起改）：
//   1. 阈值雨量：以新提交的有效值优先 —— 汛期阈值按最新核定执行；
//   2. 站点名称：以台账已有值优先 —— 档案名称不被批量件覆盖；
//   3. 所属流域：以新提交的非空值优先 —— 流域调整以最新划分为准；
//   其余字段（设备型号、通信方式等）一律以台账已有值为准。
export const RAIN_MERGE_PRIORITY =
  '阈值雨量以新提交的有效值优先；站点名称以台账已有值优先；所属流域以新提交的非空值优先；其余字段以台账为准'

// 阈值雨量的有效区间（毫米）：空值、非数字、超出区间都算无效，一律退回重填。
const THRESHOLD_MAX = 2000

function parseThreshold(raw: string): number | null {
  const text = raw.trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0 || value > THRESHOLD_MAX) {
    return null
  }
  return value
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 专家会商台账：批量操作的结果统一落到这里，会商模块的列表即是台账。
function appendConsultLedger(entries: { 主题: string; 结论: string; 措施: string }[]): void {
  if (entries.length === 0) {
    return
  }
  const rows = listRows('consult')
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  let seq = rows.reduce((max, row) => {
    const match = /^CONS-(\d+)$/.exec(String(row['会商编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const date = today()
  const added: EntryRow[] = entries.map((entry) => {
    seq += 1
    const row: EntryRow = {
      id: nextId,
      status: '待组织',
      pending: true,
      abnormal: false,
      会商编号: `CONS-${String(seq).padStart(4, '0')}`,
      会商主题: entry.主题,
      参会专家: '待排期',
      会商日期: date,
      会商结论: entry.结论,
      建议措施: entry.措施,
      纪要归档日: '',
      会商状态: '待组织',
    }
    nextId += 1
    return row
  })
  saveRows('consult', [...rows, ...added])
}

// 批量上账：勾选多条一次提交，逐条回执；缺项暂存不拦整批，阈值无效退回重填，同一站号只算一次。
export function submitRainBatch(drafts: RainStationDraft[]): BatchResult {
  const meta = moduleMeta('rain')
  const rows = listRows('rain')
  const byStation = new Map(rows.map((row) => [String(row['站号'] ?? '').trim(), row]))
  const receipts: BatchReceipt[] = []
  const seen = new Set<string>()
  const merged = new Map<string, EntryRow>()
  const added: EntryRow[] = []
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1

  for (const draft of drafts) {
    const station = draft.站号.trim()
    if (station === '') {
      receipts.push({ key: '（空站号）', kind: '退回重填', message: '站号为空，无法上账，退回重填' })
      continue
    }
    // 阈值雨量落成无效值的一律退回重填，不参与后续去重与合并
    const threshold = parseThreshold(draft.阈值雨量)
    if (threshold === null) {
      receipts.push({
        key: station,
        kind: '退回重填',
        message: `阈值雨量「${draft.阈值雨量.trim() || '空'}」不是有效值（0–${THRESHOLD_MAX} 毫米），退回重填`,
      })
      continue
    }
    // 缺站点名称或所属流域的先放在一旁（暂存待补），不因为一条不合格把整批拦住
    const missing: string[] = []
    if (draft.站点名称.trim() === '') {
      missing.push('站点名称')
    }
    if (draft.所属流域.trim() === '') {
      missing.push('所属流域')
    }
    if (missing.length > 0) {
      receipts.push({
        key: station,
        kind: '暂存待补',
        message: `缺${missing.join('、')}，先放在一旁待补，不影响本批其他站点`,
      })
      continue
    }
    // 同一站号只算一次：本批内重复的直接合并回执
    if (seen.has(station)) {
      receipts.push({ key: station, kind: '重复合并', message: '与本批前序行站号相同，只算一次' })
      continue
    }
    seen.add(station)
    const existing = byStation.get(station)
    if (existing) {
      // 与台账已有记录冲突时，按 RAIN_MERGE_PRIORITY 写清的优先级合并
      merged.set(station, { ...existing, 所属流域: draft.所属流域.trim(), 阈值雨量: threshold })
      receipts.push({
        key: station,
        kind: '重复合并',
        message: '站号已在台账，只算一次；阈值雨量、所属流域按新提交更新，站点名称以台账为准',
      })
      continue
    }
    added.push({
      id: nextId,
      status: meta.statuses[0],
      pending: true,
      abnormal: false,
      站号: station,
      站点名称: draft.站点名称.trim(),
      所属流域: draft.所属流域.trim(),
      设备型号: draft.设备型号.trim(),
      阈值雨量: threshold,
      通信方式: draft.通信方式.trim(),
      校核日期: today(),
      站点状态: meta.statuses[0],
    })
    nextId += 1
    receipts.push({ key: station, kind: '已入账', message: `已入账，当前状态「${meta.statuses[0]}」` })
  }

  if (added.length > 0 || merged.size > 0) {
    const nextRows = rows.map((row) => merged.get(String(row['站号'] ?? '').trim()) ?? row)
    saveRows('rain', [...nextRows, ...added])
  }
  // 提交结果落到专家会商台账：整批一条回执摘要，暂存与退回的站号写进建议措施
  if (receipts.length > 0) {
    const count = (kind: BatchReceipt['kind']) => receipts.filter((item) => item.kind === kind).length
    const todo = receipts
      .filter((item) => item.kind === '暂存待补' || item.kind === '退回重填')
      .map((item) => `${item.key}（${item.kind}）`)
      .join('；')
    appendConsultLedger([
      {
        主题: `雨量站批量上账回执（${today()}）`,
        结论: `提交${receipts.length}条：已入账${count('已入账')}、重复合并${count('重复合并')}、暂存待补${count('暂存待补')}、退回重填${count('退回重填')}`,
        措施: todo === '' ? '本批无待办站点' : `待办站点：${todo}`,
      },
    ])
  }
  return { receipts }
}

// 设备故障整组上报：勾选的站点一次报故障，逐条回执；状态单向流转，结果添记专家会商台账。
export function reportRainFaults(ids: number[]): BatchResult {
  const meta = moduleMeta('rain')
  const target = meta.actionTargets['登记故障']
  if (!target) {
    return { receipts: [{ key: '—', kind: '已跳过', message: '雨量站模块没有登记「登记故障」动作' }] }
  }
  const rows = listRows('rain')
  const next = [...rows]
  const receipts: BatchReceipt[] = []
  const faulted: EntryRow[] = []
  for (const id of ids) {
    const index = next.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      receipts.push({ key: String(id), kind: '已跳过', message: '没有找到该雨量站' })
      continue
    }
    const row = next[index]
    const station = String(row['站号'] ?? row.id)
    const current = String(row.status)
    if (current === target) {
      receipts.push({ key: station, kind: '已跳过', message: `已是「${target}」，不重复上报` })
      continue
    }
    if (!canTransition(meta, current, target)) {
      receipts.push({
        key: station,
        kind: '已跳过',
        message: `当前「${current}」，状态只能按「${meta.statuses.join('→')}」单向流转`,
      })
      continue
    }
    const updated: EntryRow = { ...row, status: target, pending: true, abnormal: true, 站点状态: target }
    next[index] = updated
    faulted.push(updated)
    receipts.push({ key: station, kind: '已流转', message: `已上报故障，状态流转为「${target}」，台账已添记待核故障站` })
  }
  if (faulted.length > 0) {
    saveRows('rain', next)
    // 台账添记待核故障站：同一站号已有待核记录的不再重复添记
    const pendingTopics = new Set(
      listRows('consult')
        .filter((row) => row.status === '待组织')
        .map((row) => String(row['会商主题'] ?? '')),
    )
    const entries = faulted
      .map((row) => {
        const topic = `待核故障站：${row['站号']} ${row['站点名称']}`
        if (pendingTopics.has(topic)) {
          return null
        }
        return {
          主题: topic,
          结论: '待会商',
          措施: `雨量站「${row['站点名称']}」（${row['站号']}，${row['所属流域']}）整组上报设备故障，待专家会商核验`,
        }
      })
      .filter((entry): entry is { 主题: string; 结论: string; 措施: string } => entry !== null)
    appendConsultLedger(entries)
  }
  return { receipts }
}
