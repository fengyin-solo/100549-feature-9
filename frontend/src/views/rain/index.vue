<template>
  <section class="page" data-module="rain">
    <header class="page-head">
      <div>
        <h2>雨量站网管理</h2>
        <p class="page-desc">汛期前批量上账：勾住多条一次提交、逐条回执；名称或流域缺失先搁置，不连坐；设备故障可整组上报。</p>
      </div>
      <div class="page-actions">
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

    <!-- 规则说明：流转次序、去重、冲突优先级、无效值退回都写在这里 -->
    <section class="panel">
      <h3 class="panel-title" @click="rulesOpen = !rulesOpen">
        上账与流转规则{{ rulesOpen ? '（收起）' : '（展开）' }}
      </h3>
      <ol v-if="rulesOpen" class="rule-list">
        <li>状态单向流转，固定次序，只能逐格向前，不能跳格、不能回退：<b>待安装 → 运行正常 → 设备故障 → 已撤除</b>。</li>
        <li>同一站号再次提交只算一次：本批重复行直接忽略；已在册且名称、阈值都一致的也忽略。</li>
        <li>站点名称或所属流域缺失的行先搁置一旁（本批不受影响），补齐后从搁置箱再次提交；站号在册但名称对不上的，同样搁置待核，不覆盖在册数据。</li>
        <li>阈值雨量与站点名称冲突时的优先级：<b>站号是唯一身份键，站点名称用于核验是否同一站，阈值雨量是可更新的业务参数</b>。站号+名称一致时，以本次提交的阈值雨量覆盖在册值；名称不一致则搁置待核，绝不拿阈值反推身份。</li>
        <li>阈值雨量落成无效值（空、非数字、0、负数）的一律整行退回重填，不会写成无效站点，也不拦住其他行。</li>
        <li>上账成功、阈值更新的结果落入专家会商台账；设备故障整组上报时逐条添记「待核故障站」，会商核销后销记。</li>
        <li>所属流域由「{{ basinEntries.join('、') }}」几个入口统一取数、合并去重，本页所有流域下拉共用同一份。</li>
      </ol>
    </section>

    <!-- 批量上账 -->
    <section class="panel">
      <h3 class="panel-title">汛期前批量上账</h3>
      <p class="panel-hint">
        每行一站：站号、站点名称、所属流域、阈值雨量（毫米）。可从表格逐列粘贴（支持 Tab、逗号、空格分隔），也可点下方按钮加行。
      </p>

      <div class="paste-box">
        <textarea
          v-model="pasteText"
          rows="3"
          placeholder="粘贴多行，例如：YLZ-1004,剑阁下寺雨量站,嘉陵江,55"
        ></textarea>
        <div class="paste-actions">
          <button class="btn" type="button" @click="appendPastedRows">解析并加入</button>
          <button class="btn ghost" type="button" @click="pasteText = ''">清空粘贴区</button>
        </div>
      </div>

      <table class="data-table draft-table">
        <thead>
          <tr>
            <th style="width: 44px">#</th>
            <th>站号 *</th>
            <th>站点名称</th>
            <th>所属流域</th>
            <th>阈值雨量(mm) *</th>
            <th style="width: 70px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(draft, index) in drafts" :key="draft.uid">
            <td>{{ index + 1 }}</td>
            <td><input v-model="draft.code" placeholder="如 YLZ-1004" /></td>
            <td><input v-model="draft.name" placeholder="缺失将搁置" /></td>
            <td>
              <select v-model="draft.basin">
                <option value="">缺失将搁置</option>
                <option v-for="basin in basins" :key="basin" :value="basin">{{ basin }}</option>
              </select>
            </td>
            <td><input v-model="draft.threshold" placeholder="大于0的数字" inputmode="decimal" /></td>
            <td><button class="link danger" type="button" @click="removeDraft(draft.uid)">移除</button></td>
          </tr>
          <tr v-if="!drafts.length">
            <td colspan="6" class="empty-state">还没有待上账的站点，粘贴或加行后一次提交</td>
          </tr>
        </tbody>
      </table>

      <div class="panel-actions">
        <button class="btn" type="button" @click="addDraft()">加一空行</button>
        <button class="btn" type="button" :disabled="!drafts.length" @click="fillSampleRows">填入示例（含各类回执）</button>
        <button class="btn primary" type="button" :disabled="!drafts.length" @click="submitBatch">
          勾选全部一次提交（{{ drafts.length }} 条）
        </button>
        <button class="btn ghost" type="button" :disabled="!drafts.length" @click="drafts = []">清空上账表</button>
      </div>

      <!-- 逐条回执 -->
      <div v-if="lastResult" class="receipt-box">
        <h4 class="receipt-head">
          本批回执：
          <span class="tag accepted">成功 {{ lastResult.accepted }}</span>
          <span class="tag updated">阈值更新 {{ lastResult.updated }}</span>
          <span class="tag held">搁置 {{ lastResult.held }}</span>
          <span class="tag returned">退回 {{ lastResult.returned }}</span>
          <span class="tag duplicate">重复忽略 {{ lastResult.duplicate }}</span>
        </h4>
        <table class="data-table receipt-table">
          <thead>
            <tr><th style="width: 110px">结论</th><th style="width: 130px">站号</th><th>站点名称 / 说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(receipt, index) in lastResult.receipts" :key="index">
              <td><span class="tag" :class="receipt.kind">{{ kindText(receipt.kind) }}</span></td>
              <td>{{ receipt.code }}</td>
              <td>{{ receipt.name || '—' }}<span class="receipt-msg">（{{ receipt.message }}）</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 搁置箱 -->
    <section class="panel">
      <h3 class="panel-title">搁置箱（资料不齐 / 名称待核，不拦住任何一批）<span class="held-count">{{ heldDrafts.length }}</span></h3>
      <table v-if="heldDrafts.length" class="data-table">
        <thead>
          <tr>
            <th style="width: 26px"><input type="checkbox" :checked="heldCheckedAll" @change="toggleHeldAll" /></th>
            <th>站号</th>
            <th>站点名称</th>
            <th>所属流域</th>
            <th>阈值雨量(mm)</th>
            <th style="width: 70px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in heldDrafts" :key="draft.uid">
            <td><input type="checkbox" v-model="heldSelected" :value="draft.uid" /></td>
            <td>{{ draft.code }}</td>
            <td><input v-model="draft.name" placeholder="补站点名称" /></td>
            <td>
              <select v-model="draft.basin">
                <option value="">补所属流域</option>
                <option v-for="basin in basins" :key="basin" :value="basin">{{ basin }}</option>
              </select>
            </td>
            <td>{{ draft.threshold }}</td>
            <td><button class="link danger" type="button" @click="dropHeld(draft.uid)">丢弃</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state panel-empty">搁置箱是空的</p>
      <div v-if="heldDrafts.length" class="panel-actions">
        <button class="btn primary" type="button" :disabled="!heldSelected.length" @click="resubmitHeld">
          将勾选的 {{ heldSelected.length }} 条补齐后再次提交
        </button>
      </div>
    </section>

    <!-- 在册站点：整组动作 -->
    <section class="panel">
      <h3 class="panel-title">在册雨量站（勾选后整组执行，逐条回执）</h3>
      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <div class="group-bar">
        <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="runGroup('提交安装')">
          整组提交安装（{{ selectedIds.length }}）
        </button>
        <button class="btn" type="button" :disabled="!selectedIds.length" @click="runGroup('登记故障')">
          整组上报设备故障（{{ selectedIds.length }}）
        </button>
        <button class="btn" type="button" :disabled="!selectedIds.length" @click="runGroup('办理撤除')">
          整组办理撤除（{{ selectedIds.length }}）
        </button>
        <span class="group-hint">状态不对的条会被逐条退回，不影响同组其他条；流转只能沿「待安装→运行正常→设备故障→已撤除」逐格向前。</span>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 36px"><input type="checkbox" :checked="pageCheckedAll" @change="togglePageAll" /></th>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td><input type="checkbox" v-model="selectedIds" :value="Number(row.id)" /></td>
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-tag" :class="statusClass(String(row.status))">{{ row.status }}</span></td>
            <td class="row-actions">
              <button
                v-if="nextActionFor(String(row.status))"
                class="link"
                type="button"
                @click="runSingle(nextActionFor(String(row.status))!, row)"
              >
                {{ nextActionFor(String(row.status)) }}
              </button>
              <span v-else class="muted-text">已到末态</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无雨量站网数据，可先批量上账</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条雨量站网记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import {
  RAIN_FLOW,
  RAIN_KIND_TEXT,
  batchOnboard,
  batchTransition,
  minThreshold,
  nextActionFor,
  transitionStation,
} from '@/api/rain-service'
import { basinEntries, basinSnapshot, fetchBasins } from '@/data/basin-catalog'
import { listHeldDrafts, removeHeldDraft } from '@/data/rain-drafts'
import { listPendingFaults } from '@/data/consult-ledger'
import { useSessionStore } from '@/stores/session'
import type { BatchResult, EntryRow, RainDraft, RainReceiptKind } from '@/data/types'

const store = useSessionStore()
const columns = ["站号", "站点名称", "所属流域", "设备型号", "阈值雨量", "通信方式", "校核日期", "站点状态"]
const filterFields = ["站号", "站点名称", "所属流域"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const rulesOpen = ref(false)
const basins = ref<string[]>(basinSnapshot())
const pasteText = ref('')
let draftSeq = 1
const drafts = ref<RainDraft[]>([])
const heldDrafts = ref<RainDraft[]>(listHeldDrafts())
const heldSelected = ref<number[]>([])
const lastResult = ref<BatchResult | null>(null)
const selectedIds = ref<number[]>([])

const stats = computed(() => [
  { label: '运行正常站点', value: rows.value.filter((row) => String(row.status) === '运行正常').length },
  { label: '故障站点', value: rows.value.filter((row) => String(row.status) === '设备故障').length },
  { label: '待核故障站（会商台账）', value: listPendingFaults().length },
  { label: '阈值雨量最小值(mm)', value: minThreshold() ?? '—' },
])

const statusSummary = computed(() =>
  RAIN_FLOW.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const heldCheckedAll = computed(
  () => heldDrafts.value.length > 0 && heldSelected.value.length === heldDrafts.value.length,
)
const pageCheckedAll = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function kindText(kind: RainReceiptKind): string {
  return RAIN_KIND_TEXT[kind]
}

function statusClass(status: string): string {
  if (status === '设备故障') return 'fault'
  if (status === '已撤除') return 'removed'
  if (status === '运行正常') return 'running'
  return ''
}

function addDraft(seed?: Partial<RainDraft>): void {
  drafts.value.push({ uid: draftSeq++, code: '', name: '', basin: '', threshold: '', ...seed })
}

function removeDraft(uid: number): void {
  drafts.value = drafts.value.filter((draft) => draft.uid !== uid)
}

function appendPastedRows(): void {
  const lines = pasteText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const cells = line.split(/\t|,|，|\s+/).map((cell) => cell.trim())
    addDraft({
      code: cells[0] ?? '',
      name: cells[1] ?? '',
      basin: cells[2] ?? '',
      threshold: cells[3] ?? '',
    })
  }
  pasteText.value = ''
}

function fillSampleRows(): void {
  drafts.value = []
  draftSeq = 1
  const samples: Array<[string, string, string, string]> = [
    ['YLZ-2001', '旺苍高阳雨量站', '嘉陵江', '50'],
    ['YLZ-2002', '', '渠江', '40'],
    ['YLZ-2003', '青川三锅雨量站', '', '65'],
    ['YLZ-2004', '朝天曾家雨量站', '岷江', '0'],
    ['YLZ-2001', '旺苍高阳雨量站', '嘉陵江', '99'],
    ['YLZ-1001', '错配名称雨量站', '嘉陵江', '55'],
    ['YLZ-1001', '青川东河口雨量站', '嘉陵江', '55'],
    ['YLZ-2005', '剑阁盐店雨量站', '涪江', '38'],
  ]
  for (const [code, name, basin, threshold] of samples) {
    addDraft({ code, name, basin, threshold })
  }
}

function submitBatch(): void {
  errorMessage.value = ''
  const valid = drafts.value.filter((draft) =>
    [draft.code, draft.name, draft.basin, draft.threshold].some((cell) => cell.trim() !== ''),
  )
  if (!valid.length) {
    errorMessage.value = '上账表没有任何内容'
    return
  }
  lastResult.value = batchOnboard(valid.map((draft) => ({
    uid: draft.uid,
    code: draft.code.trim(),
    name: draft.name.trim(),
    basin: draft.basin.trim(),
    threshold: draft.threshold.trim(),
  })), store.operator)
  // 上账成功/阈值更新的行从上账表移除；退回（改阈值）和搁置的行留在表里继续改。
  const handledCodes = new Set(
    lastResult.value.receipts
      .filter((receipt) => receipt.kind === 'accepted' || receipt.kind === 'updated')
      .map((receipt) => receipt.code),
  )
  drafts.value = drafts.value.filter((draft) => !handledCodes.has(draft.code.trim()))
  heldDrafts.value = listHeldDrafts()
  heldSelected.value = []
  reload()
}

function toggleHeldAll(event: Event): void {
  heldSelected.value = (event.target as HTMLInputElement).checked
    ? heldDrafts.value.map((draft) => draft.uid)
    : []
}

function togglePageAll(event: Event): void {
  selectedIds.value = (event.target as HTMLInputElement).checked
    ? rows.value.map((row) => Number(row.id))
    : []
}

function dropHeld(uid: number): void {
  removeHeldDraft(uid)
  heldDrafts.value = listHeldDrafts()
  heldSelected.value = heldSelected.value.filter((id) => id !== uid)
}

function resubmitHeld(): void {
  const picked = heldDrafts.value.filter((draft) => heldSelected.value.includes(draft.uid))
  lastResult.value = batchOnboard(picked.map((draft) => ({
    uid: draft.uid,
    code: draft.code.trim(),
    name: draft.name.trim(),
    basin: draft.basin.trim(),
    threshold: draft.threshold.trim(),
  })), store.operator)
  heldDrafts.value = listHeldDrafts()
  heldSelected.value = []
  reload()
}

function runGroup(action: '提交安装' | '登记故障' | '办理撤除'): void {
  errorMessage.value = ''
  const ids = [...selectedIds.value]
  if (!ids.length) {
    return
  }
  lastResult.value = batchTransition(action, ids, store.operator)
  selectedIds.value = []
  reload()
}

function runSingle(action: '提交安装' | '登记故障' | '办理撤除', row: EntryRow): void {
  const result = transitionStation(Number(row.id), action, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  lastResult.value = {
    action,
    receipts: [{
      code: String(row['站号'] ?? ''),
      name: String(row['站点名称'] ?? ''),
      kind: 'accepted',
      message: result.message,
    }],
    accepted: 1,
    held: 0,
    returned: 0,
    duplicate: 0,
    updated: 0,
  }
  reload()
}

function resetFilters(): void {
  filters.value = {}
  reload()
}

function exportRows(): void {
  downloadEntries('rain')
}

function reload(): void {
  errorMessage.value = ''
  try {
    const payload = listEntries('rain', filters.value)
    rows.value = payload.items
    total.value = payload.total
    selectedIds.value = selectedIds.value.filter((id) => rows.value.some((row) => Number(row.id) === id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '雨量站网列表读取失败'
  }
}

onMounted(() => {
  fetchBasins().then((merged) => {
    if (merged.length) {
      basins.value = merged
    }
  })
  reload()
})
</script>
