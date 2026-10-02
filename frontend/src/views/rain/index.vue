<template>
  <section class="page" data-module="rain">
    <header class="page-head">
      <div>
        <h2>雨量站网管理</h2>
        <p class="page-desc">
          维护雨量站，围绕站号、站点名称、所属流域、设备型号做登记、筛选与状态流转。汛期前可批量上账：勾选多条一次提交、逐条回执，缺项暂存不拦整批。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleBatch">
          {{ batchOpen ? '收起批量上账' : '批量上账' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出雨量站网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="batchOpen" class="batch-panel">
      <h3 class="batch-title">批量上账（汛期前集中登记）</h3>
      <p class="batch-note">
        同一站号重复提交只算一次；字段冲突优先级：{{ mergePriority }}。
        阈值雨量须为 0–2000 毫米的有效数字，落成无效值的一律退回重填；缺站点名称或所属流域的先放在一旁（暂存待补），不拦整批。
      </p>
      <table class="data-table batch-table">
        <thead>
          <tr>
            <th class="check-col"></th>
            <th>站号</th>
            <th>站点名称</th>
            <th>所属流域</th>
            <th>阈值雨量(mm)</th>
            <th>设备型号</th>
            <th>通信方式</th>
            <th>回执</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(draft, index) in drafts" :key="index">
            <td class="check-col"><input v-model="draft.checked" type="checkbox" /></td>
            <td><input v-model="draft.站号" placeholder="如 RAIN-0007" /></td>
            <td><input v-model="draft.站点名称" placeholder="必填" /></td>
            <td>
              <select v-model="draft.所属流域">
                <option value="" disabled>选择流域</option>
                <option v-for="item in watersheds" :key="item" :value="item">{{ item }}</option>
              </select>
            </td>
            <td><input v-model="draft.阈值雨量" inputmode="decimal" placeholder="必填" /></td>
            <td><input v-model="draft.设备型号" /></td>
            <td><input v-model="draft.通信方式" /></td>
            <td class="receipt-cell">
              <span v-if="draft.receipt" class="receipt" :data-kind="draft.receipt.kind">
                {{ draft.receipt.kind }}：{{ draft.receipt.message }}
              </span>
              <span v-else>—</span>
            </td>
            <td><button class="link" type="button" @click="removeDraft(index)">移除</button></td>
          </tr>
          <tr v-if="!drafts.length">
            <td colspan="9" class="empty-state">暂无草稿行，点「添加一行」开始批量登记</td>
          </tr>
        </tbody>
      </table>
      <div class="batch-actions">
        <button class="btn" type="button" @click="addDraft">添加一行</button>
        <button class="btn primary" type="button" @click="submitBatch">
          提交勾选站点（{{ checkedCount }}）
        </button>
        <span v-if="batchSummary" class="batch-summary">{{ batchSummary }}</span>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input
          v-model="filters[field]"
          :placeholder="`按${field}检索`"
          :list="field === '所属流域' ? 'watershed-options' : undefined"
        />
      </label>
      <datalist id="watershed-options">
        <option v-for="item in watersheds" :key="item" :value="item" />
      </datalist>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="fault-bar">
      <button class="btn" type="button" @click="reportFaults">整组上报故障（{{ selectedCount }}）</button>
      <span class="fault-hint">
        勾选下表站点后整组上报；状态只按 待安装→运行正常→设备故障→已撤除 单向流转，结果逐条回执并添记专家会商台账。
      </span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input v-model="selectedIds" type="checkbox" :value="Number(row.id)" />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无雨量站网数据，可先在批量上账面板登记</td>
        </tr>
      </tbody>
    </table>

    <ul v-if="faultReceipts.length" class="receipt-list">
      <li v-for="receipt in faultReceipts" :key="receipt.key" class="receipt" :data-kind="receipt.kind">
        {{ receipt.key }}：{{ receipt.message }}
      </li>
    </ul>

    <footer class="page-foot">
      <span>共 {{ total }} 条雨量站网记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  RAIN_MERGE_PRIORITY,
  downloadEntries,
  listEntries,
  moduleMeta,
  reportRainFaults,
  runAction as applyAction,
  submitRainBatch,
} from '@/api/local-service'
import { listWatersheds } from '@/data/watersheds'
import type { BatchReceipt, EntryRow, RainStationDraft } from '@/data/types'

const meta = moduleMeta('rain')
const columns = ["站号", "站点名称", "所属流域", "设备型号", "阈值雨量", "通信方式", "校核日期", "站点状态"]
const actions = ["提交安装", "登记故障", "办理撤除"]
const statuses = ["待安装", "运行正常", "设备故障", "已撤除"]
const mergePriority = RAIN_MERGE_PRIORITY
// 所属流域名录只从这一个入口取，批量表单和筛选框共用，不各取各的
const watersheds = listWatersheds()

type DraftRow = RainStationDraft & { checked: boolean; receipt: BatchReceipt | null }

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const batchOpen = ref(false)
const drafts = ref<DraftRow[]>([])
const batchSummary = ref('')
const selectedIds = ref<number[]>([])
const faultReceipts = ref<BatchReceipt[]>([])

const stats = computed(() => {
  const thresholds = rows.value
    .map((row) => Number(row['阈值雨量']))
    .filter((value) => Number.isFinite(value) && value > 0)
  return [
    { label: '运行正常站点', value: rows.value.filter((row) => row.status === '运行正常').length },
    { label: '故障站点', value: rows.value.filter((row) => row.status === '设备故障').length },
    { label: '阈值雨量最小值', value: thresholds.length > 0 ? Math.min(...thresholds) : '—' },
  ]
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const checkedCount = computed(() => drafts.value.filter((draft) => draft.checked).length)
const selectedCount = computed(() => selectedIds.value.length)
const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleBatch() {
  batchOpen.value = !batchOpen.value
  if (batchOpen.value && drafts.value.length === 0) {
    addDraft()
  }
}

function emptyDraft(): DraftRow {
  return { 站号: '', 站点名称: '', 所属流域: '', 阈值雨量: '', 设备型号: '', 通信方式: '', checked: true, receipt: null }
}

function addDraft() {
  drafts.value.push(emptyDraft())
}

function removeDraft(index: number) {
  drafts.value.splice(index, 1)
}

function submitBatch() {
  errorMessage.value = ''
  batchSummary.value = ''
  const picked = drafts.value.filter((draft) => draft.checked)
  if (picked.length === 0) {
    errorMessage.value = '请先勾选要提交的站点行'
    return
  }
  const result = submitRainBatch(
    picked.map((draft) => ({
      站号: draft.站号,
      站点名称: draft.站点名称,
      所属流域: draft.所属流域,
      阈值雨量: draft.阈值雨量,
      设备型号: draft.设备型号,
      通信方式: draft.通信方式,
    })),
  )
  // 回执与勾选行一一对应：已入账/重复合并的从草稿区清掉，暂存与退回的留在草稿区待补
  const kept: DraftRow[] = []
  picked.forEach((draft, index) => {
    const receipt = result.receipts[index]
    if (receipt && (receipt.kind === '暂存待补' || receipt.kind === '退回重填')) {
      kept.push({ ...draft, receipt })
    }
  })
  drafts.value = [...drafts.value.filter((draft) => !draft.checked), ...kept]
  const count = (kind: BatchReceipt['kind']) => result.receipts.filter((item) => item.kind === kind).length
  batchSummary.value =
    `本批提交 ${result.receipts.length} 条：已入账 ${count('已入账')} · 重复合并 ${count('重复合并')} · ` +
    `暂存待补 ${count('暂存待补')} · 退回重填 ${count('退回重填')}；结果已落专家会商台账`
  reload()
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? rows.value.map((row) => Number(row.id)) : []
}

function reportFaults() {
  errorMessage.value = ''
  faultReceipts.value = []
  if (selectedIds.value.length === 0) {
    errorMessage.value = '请先勾选要上报故障的站点'
    return
  }
  const result = reportRainFaults(selectedIds.value)
  faultReceipts.value = result.receipts
  selectedIds.value = []
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '雨量站网列表读取失败'
  }
}

onMounted(reload)
</script>
