/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 雨量站网批量上账 =====

/** 上账表/搁置箱里的一行：内容来自人工录入或粘贴，还没落成正式站点。 */
export type RainDraft = {
  uid: number
  code: string
  name: string
  basin: string
  threshold: string
}

/** 逐条回执：一行一个结论，互不连坐。 */
export type RainReceiptKind = 'accepted' | 'held' | 'returned' | 'duplicate' | 'updated'

export type RainReceipt = {
  code: string
  name: string
  kind: RainReceiptKind
  message: string
}

export type BatchResult = {
  action: string
  receipts: RainReceipt[]
  accepted: number
  held: number
  returned: number
  duplicate: number
  updated: number
}

// ===== 专家会商台账（雨量站网上账结果与待核故障站） =====

export type LedgerEntryType = '上账结果' | '待核故障站'

export type LedgerEntry = {
  id: number
  type: LedgerEntryType
  stationId?: number
  code: string
  name: string
  basin: string
  thresholdMm?: number
  detail: string
  operator: string
  createdAt: string
  verified: boolean
  verifiedAt?: string
  verifiedNote?: string
}
