<template>
  <section class="page" data-module="consult">
    <header class="page-head">
      <div>
        <h2>专家会商管理</h2>
        <p class="page-desc">维护专家会商，围绕会商编号、会商主题、参会专家、会商日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记专家会商</button>
        <button class="btn" type="button" @click="exportRows">导出专家会商清单</button>
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

    <!-- 雨量站网提交台账：上账结果 + 待核故障站 -->
    <section class="panel">
      <h3 class="panel-title">雨量站网上账台账 · 待核故障站（{{ pendingFaults.length }}）</h3>
      <table v-if="pendingFaults.length" class="data-table">
        <thead>
          <tr><th>站号</th><th>站点名称</th><th>所属流域</th><th>阈值(mm)</th><th>上报说明</th><th>上报人</th><th>核销</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in pendingFaults" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.basin || '—' }}</td>
            <td>{{ item.thresholdMm ?? '—' }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.operator }}</td>
            <td>
              <button class="btn" type="button" @click="verifyOne(item.id)">现场复核属实，核销</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state panel-empty">暂无待核故障站</p>

      <h4 class="ledger-title">全部上账与处置记录（{{ ledger.length }}）</h4>
      <table class="data-table">
        <thead>
          <tr><th>类型</th><th>站号</th><th>站点名称</th><th>所属流域</th><th>阈值(mm)</th><th>说明</th><th>经办人</th><th>时间</th><th>核销</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in ledger" :key="item.id">
            <td><span class="tag" :class="item.type === '待核故障站' ? (item.verified ? 'updated' : 'held') : 'accepted'">{{ item.type }}</span></td>
            <td>{{ item.code }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.basin || '—' }}</td>
            <td>{{ item.thresholdMm ?? '—' }}</td>
            <td>{{ item.detail }}<span v-if="item.verifiedNote" class="receipt-msg">（{{ item.verifiedNote }}）</span></td>
            <td>{{ item.operator }}</td>
            <td>{{ formatTime(item.createdAt) }}</td>
            <td>{{ item.verified ? `已核销 ${formatTime(item.verifiedAt ?? '')}` : '—' }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="9" class="empty-state">雨量站网还没有提交记录，台账为空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无专家会商数据，可先登记专家会商</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条专家会商记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listLedger, listPendingFaults, verifyFault } from '@/data/consult-ledger'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, LedgerEntry } from '@/data/types'

const store = useSessionStore()
const ledger = ref<LedgerEntry[]>([])
const pendingFaults = ref<LedgerEntry[]>([])

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function refreshLedger(): void {
  ledger.value = listLedger()
  pendingFaults.value = listPendingFaults()
}

function verifyOne(id: number): void {
  verifyFault(id, `${store.operator} 于专家会商现场复核确认`)
  refreshLedger()
}

const meta = moduleMeta('consult')
const columns = ["会商编号", "会商主题", "参会专家", "会商日期", "会商结论", "建议措施", "纪要归档日", "会商状态"]
const actions = ["确认组织", "提交结论", "取消会商"]
const statuses = ["待组织", "已组织", "已出结论", "已取消"]
const stats = [{"label": "待组织会商", "value": 0}, {"label": "已出结论会商", "value": 0}, {"label": "本月会商次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '专家会商登记入口尚未接入审批流'
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
    errorMessage.value = error instanceof Error ? error.message : '专家会商列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshLedger()
})
</script>
