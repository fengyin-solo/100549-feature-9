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
  /** 为 true 时状态只能沿 statuses 的固定次序单向流转（如雨量站：待安装→运行正常→设备故障→已撤除）。 */
  oneWay?: boolean
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

/** 雨量站批量上账的草稿行：提交前都是字符串，校验统一在服务层做。 */
export type RainStationDraft = {
  站号: string
  站点名称: string
  所属流域: string
  阈值雨量: string
  设备型号: string
  通信方式: string
}

/** 批量提交的逐条回执类别：入账/合并/暂存/退回用于批量上账，流转/跳过用于故障整组上报。 */
export type ReceiptKind = '已入账' | '重复合并' | '暂存待补' | '退回重填' | '已流转' | '已跳过'

export type BatchReceipt = {
  /** 回执对应的业务键：雨量站用站号，找不到站号时退回内部编号。 */
  key: string
  kind: ReceiptKind
  message: string
}

export type BatchResult = {
  /** 与提交的草稿行一一对应、顺序一致，页面按下标把回执落回每一行。 */
  receipts: BatchReceipt[]
}
