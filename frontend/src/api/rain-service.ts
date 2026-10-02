import { listRows, saveRows } from '@/data/local-store'
import { appendLedger } from '@/data/consult-ledger'
import { upsertHeldDrafts } from '@/data/rain-drafts'
import type {
  ActionResult,
  BatchResult,
  EntryRow,
  RainDraft,
  RainReceipt,
  RainReceiptKind,
} from '@/data/types'

const MODULE_KEY = 'rain'
const FAULT_LEDGER_ACTION = '登记故障'

// 站点状态单向流转，固定次序，只能逐格向前，不能跳格、不能回退：
// 待安装 → 运行正常 → 设备故障 → 已撤除
export const RAIN_FLOW = ['待安装', '运行正常', '设备故障', '已撤除'] as const

export const RAIN_ACTIONS = {
  提交安装: '运行正常',
  登记故障: '设备故障',
  办理撤除: '已撤除',
} as const

export const RAIN_KIND_TEXT: Record<RainReceiptKind, string> = {
  accepted: '上账成功',
  updated: '阈值更新',
  held: '搁置一旁',
  returned: '退回重填',
  duplicate: '重复忽略',
}

/**
 * 阈值雨量有效性：必须是大于 0 的有限数值（毫米）。
 * 空串、非数字、0、负数、Infinity、NaN 一律算无效值。
 */
export function parseThreshold(raw: string): number | null {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

function nextStationId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyBatch(action: string): BatchResult {
  return { action, receipts: [], accepted: 0, held: 0, returned: 0, duplicate: 0, updated: 0 }
}

function tally(result: BatchResult, receipt: RainReceipt): void {
  result.receipts.push(receipt)
  result[receipt.kind] += 1
}

/**
 * 批量上账。一行一结论，互不连坐；处理次序（优先级判定）固定如下：
 *
 * 1. 站号是唯一身份键。站号缺失：无法定位，整行退回。
 * 2. 阈值雨量是数值业务参数，不参与身份判定。空/非数/≤0 等无效值：整行退回重填，
 *    不会落成无效站点。
 * 3. 站点名称、所属流域是必填档案项，缺任一项：整行先搁置一旁，不拦同批其他行，
 *    补齐后可再次提交。
 * 4. 同一站号在本批再次出现：只算一次（前一行若已上账/更新/搁置，后一行记重复忽略；
 *    前一行是退回的，后一行资料齐全时仍可上账）。
 * 5. 站号已在册时的冲突优先级：
 *    a. 站点名称与在册名称一致 → 认定为同一站；阈值雨量以本次提交为准，更新在册值；
 *       阈值相同则记重复忽略。
 *    b. 站点名称与在册名称不一致 → 身份冲突，整行搁置待核，不覆盖在册名称、不改阈值。
 *    c. 在册站点已撤除 → 状态单向不可逆，记重复忽略，不重新启用。
 *
 * 上账成功与阈值更新的结果落入专家会商台账；退回与搁置属于入账前的质量拦截，
 * 不写台账。
 */
export function batchOnboard(inputs: RainDraft[], operator: string): BatchResult {
  const result = emptyBatch('批量上账')
  const rows = [...listRows(MODULE_KEY)]
  const claimed = new Set<string>()
  const heldNow: RainDraft[] = []

  for (const draft of inputs) {
    const code = draft.code.trim()
    const name = draft.name.trim()
    const basin = draft.basin.trim()

    if (!code) {
      tally(result, {
        code: code || '（空站号）',
        name,
        kind: 'returned',
        message: '站号缺失，无法定位站点，退回补填站号',
      })
      continue
    }

    const thresholdMm = parseThreshold(draft.threshold)
    if (thresholdMm === null) {
      tally(result, {
        code,
        name,
        kind: 'returned',
        message: `阈值雨量「${draft.threshold}」无效：须为大于 0 的数字（毫米），退回重填`,
      })
      continue
    }

    if (!name || !basin) {
      heldNow.push({ ...draft, code, name, basin })
      tally(result, {
        code,
        name,
        kind: 'held',
        message: `缺${[!name && '站点名称', !basin && '所属流域'].filter(Boolean).join('、')}，先搁置一旁，补齐后再提交`,
      })
      continue
    }

    if (claimed.has(code)) {
      tally(result, {
        code,
        name,
        kind: 'duplicate',
        message: '同一站号本批已提交过，只算一次，本条忽略',
      })
      continue
    }

    const existing = rows.find((row) => String(row['站号'] ?? '').trim() === code)
    if (existing) {
      const existingName = String(existing['站点名称'] ?? '').trim()
      if (String(existing.status) === '已撤除') {
        tally(result, {
          code,
          name,
          kind: 'duplicate',
          message: '该站号站点已撤除，状态单向不可逆，不重新启用',
        })
        continue
      }
      if (existingName !== name) {
        heldNow.push({ ...draft, code, name, basin })
        tally(result, {
          code,
          name,
          kind: 'held',
          message: `站号已在册（在册名称「${existingName}」），名称对不上，搁置待核；不覆盖在册名称与阈值`,
        })
        continue
      }
      const oldThreshold = parseThreshold(String(existing['阈值雨量'] ?? ''))
      if (oldThreshold !== null && oldThreshold === thresholdMm) {
        tally(result, {
          code,
          name,
          kind: 'duplicate',
          message: '站号、站点名称、阈值雨量均与在册一致，只算一次，本条忽略',
        })
        continue
      }
      existing['阈值雨量'] = thresholdMm
      claimed.add(code)
      tally(result, {
        code,
        name,
        kind: 'updated',
        message: `站号与名称一致，按优先级以本次阈值为准：${oldThreshold ?? '原阈值无效'}mm → ${thresholdMm}mm`,
      })
      appendLedger({
        type: '上账结果',
        stationId: Number(existing.id),
        code,
        name,
        basin,
        thresholdMm,
        detail: `阈值雨量更新：${oldThreshold ?? '原阈值无效'}mm → ${thresholdMm}mm`,
        operator,
      })
      continue
    }

    const id = nextStationId(rows)
    const station: EntryRow = {
      id,
      status: '待安装',
      pending: true,
      abnormal: false,
      站号: code,
      站点名称: name,
      所属流域: basin,
      设备型号: '',
      阈值雨量: thresholdMm,
      通信方式: '',
      校核日期: today(),
      站点状态: '待安装',
    }
    rows.push(station)
    claimed.add(code)
    tally(result, {
      code,
      name,
      kind: 'accepted',
      message: `上账成功，阈值雨量 ${thresholdMm}mm，进入「待安装」`,
    })
    appendLedger({
      type: '上账结果',
      stationId: id,
      code,
      name,
      basin,
      thresholdMm,
      detail: `汛期前批量上账，阈值雨量 ${thresholdMm}mm，状态「待安装」`,
      operator,
    })
  }

  saveRows(MODULE_KEY, rows)
  if (heldNow.length) {
    upsertHeldDrafts(heldNow)
  }
  return result
}

function transitionOne(
  rows: EntryRow[],
  id: number,
  action: keyof typeof RAIN_ACTIONS,
  operator: string,
): RainReceipt {
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { code: `#${id}`, name: '', kind: 'returned', message: '站点不存在，跳过' }
  }
  const code = String(row['站号'] ?? '')
  const name = String(row['站点名称'] ?? '')
  const current = String(row.status)
  const target = RAIN_ACTIONS[action]
  const currentIndex = RAIN_FLOW.indexOf(current as (typeof RAIN_FLOW)[number])
  const targetIndex = RAIN_FLOW.indexOf(target)

  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    return {
      code,
      name,
      kind: 'returned',
      message: `当前「${current}」不能${action}到「${target}」：状态只能按 ${RAIN_FLOW.join('→')} 逐格向前`,
    }
  }

  row.status = target
  row['站点状态'] = target
  row.pending = target !== '已撤除'
  if (action === FAULT_LEDGER_ACTION) {
    // 设备故障：整组可上报，逐条添记待核故障站，进专家会商台账等待核销。
    row.abnormal = true
    appendLedger({
      type: '待核故障站',
      stationId: Number(row.id),
      code,
      name,
      basin: String(row['所属流域'] ?? ''),
      thresholdMm: parseThreshold(String(row['阈值雨量'] ?? '')) ?? undefined,
      detail: `${action}整组上报：状态由「${current}」转「${target}」，待专家现场复核`,
      operator,
    })
  }
  return { code, name, kind: 'accepted', message: `${action}成功：「${current}」→「${target}」` }
}

/** 整组动作（提交安装 / 登记故障 / 办理撤除）：逐条回执，一条状态不对不拦其他条。 */
export function batchTransition(
  action: keyof typeof RAIN_ACTIONS,
  ids: number[],
  operator: string,
): BatchResult {
  const result = emptyBatch(action)
  const rows = [...listRows(MODULE_KEY)]
  for (const id of ids) {
    tally(result, transitionOne(rows, id, action, operator))
  }
  saveRows(MODULE_KEY, rows)
  return result
}

/** 单站动作：复用与整组相同的单向流转校验，保证页面逐条操作也不能跳格/回退。 */
export function transitionStation(
  id: number,
  action: keyof typeof RAIN_ACTIONS,
  operator: string,
): ActionResult {
  const rows = [...listRows(MODULE_KEY)]
  const receipt = transitionOne(rows, id, action, operator)
  if (receipt.kind !== 'accepted') {
    return { ok: false, message: receipt.message }
  }
  saveRows(MODULE_KEY, rows)
  return { ok: true, message: receipt.message }
}

/** 当前状态允许执行的下一个动作（单向逐格），用于页面按钮启停。 */
export function nextActionFor(status: string): keyof typeof RAIN_ACTIONS | null {
  const index = RAIN_FLOW.indexOf(status as (typeof RAIN_FLOW)[number])
  if (index < 0 || index >= RAIN_FLOW.length - 1) {
    return null
  }
  const target = RAIN_FLOW[index + 1]
  return (Object.entries(RAIN_ACTIONS).find(([, value]) => value === target)?.[0] ??
    null) as keyof typeof RAIN_ACTIONS | null
}

/** 阈值雨量最小值（毫米）：只统计在册的有效阈值。 */
export function minThreshold(): number | null {
  let min: number | null = null
  for (const row of listRows(MODULE_KEY)) {
    const value = parseThreshold(String(row['阈值雨量'] ?? ''))
    if (value !== null && (min === null || value < min)) {
      min = value
    }
  }
  return min
}
