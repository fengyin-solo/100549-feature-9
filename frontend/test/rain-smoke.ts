// 雨量站网批量规则冒烟验证：node 环境，localStorage 用内存桩代替。
const mem = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
  },
}

import { batchOnboard, batchTransition, minThreshold, transitionStation } from '../src/api/rain-service'
import { listHeldDrafts } from '../src/data/rain-drafts'
import { listLedger, listPendingFaults, verifyFault } from '../src/data/consult-ledger'
import { listRows } from '../src/data/local-store'
import type { RainDraft } from '../src/data/types'

let failures = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`✗ ${label}\n  expected=${JSON.stringify(expected)}\n  actual  =${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

let seq = 0
const d = (code: string, name: string, basin: string, threshold: string): RainDraft => ({
  uid: ++seq, code, name, basin, threshold,
})

// 1) 一批覆盖所有回执类型
const r1 = batchOnboard([
  d('YLZ-2001', '旺苍高阳雨量站', '嘉陵江', '50'),     // accepted
  d('YLZ-2002', '', '渠江', '40'),                    // held 缺名称
  d('YLZ-2003', '朝天曾家雨量站', '', '65'),          // held 缺流域
  d('YLZ-2004', '青川三锅雨量站', '岷江', '0'),       // returned 无效阈值
  d('YLZ-2005', '剑阁盐店雨量站', '涪江', '大雨'),     // returned 非数字
  d('', '无站号站', '涪江', '30'),                    // returned 缺站号
  d('YLZ-2001', '旺苍高阳雨量站', '嘉陵江', '99'),    // duplicate 批内重复
  d('YLZ-1001', '错配名称雨量站', '嘉陵江', '55'),    // held 名称对不上（排在同站号有效行之前，搁置待核）
  d('YLZ-1001', '青川东河口雨量站', '嘉陵江', '55'),  // updated 在册同名校验，阈值 50→55
  d('YLZ-1002', '北川陈家坝雨量站', '涪江', '60'),    // duplicate 完全一致
], '测试员')

check('批量: 成功数', r1.accepted, 1)
check('批量: 搁置数', r1.held, 3)
check('批量: 退回数', r1.returned, 3)
check('批量: 重复数', r1.duplicate, 2)
check('批量: 更新数', r1.updated, 1)
check('批量: 回执逐条=提交行数', r1.receipts.length, 10)

// 2) 不合格行不连坐：新站确实在册
const created = listRows('rain').find((row) => row['站号'] === 'YLZ-2001')
check('成功行落册为待安装', created && created.status, '待安装')
check('成功行阈值取数值', created && created['阈值雨量'], 50)

// 3) 阈值更新按优先级生效
const s1001 = listRows('rain').find((row) => row['站号'] === 'YLZ-1001')
check('在册站阈值被本次覆盖', s1001 && s1001['阈值雨量'], 55)

// 4) 搁置箱持久化，且同站号只留一版
check('搁置箱条数(同站号覆盖)', listHeldDrafts().length, 3)

// 5) 搁置补齐后再提交：缺名称的补上名称
const held2002 = listHeldDrafts().find((item) => item.code === 'YLZ-2002')!
const r2 = batchOnboard([{ ...held2002, name: '补录名称站' }], '测试员')
check('补齐后上账成功', r2.accepted, 1)

// 6) 台账只记成功/更新，退回与搁置不入账
check('台账上账结果条数(成功2+更新1)',
  listLedger().filter((x) => x.type === '上账结果').length, 3)
check('退回/搁置未污染台账',
  listLedger().some((x) => x.code === 'YLZ-2004' || x.code === 'YLZ-2003'), false)

// 7) 整组故障上报：运行正常的转故障，状态不对的逐条退回，互不连坐
const normalIds = listRows('rain').filter((row) => row.status === '运行正常').map((row) => Number(row.id))
const pendingInstallId = Number(listRows('rain').find((row) => row.status === '待安装')!.id)
const r3 = batchTransition('登记故障', [...normalIds, pendingInstallId], '测试员')
check('故障组: 成功条数', r3.accepted, normalIds.length)
check('故障组: 待安装站被退回', r3.returned, 1)
check('待核故障站入台账数', listPendingFaults().length, normalIds.length)

// 8) 单向流转：不能跳格（待安装不能直接撤除）、不能回退
const r4 = transitionStation(pendingInstallId, '办理撤除', '测试员')
check('跳格被拒', r4.ok, false)
const faultId = normalIds[0]
const r5 = transitionStation(faultId, '提交安装', '测试员')
check('回退被拒', r5.ok, false)
// 故障→撤除 合法
const r6 = transitionStation(faultId, '办理撤除', '测试员')
check('故障可撤除', r6.ok, true)
// 撤除后重新提交不启用
const r7 = batchOnboard([d('YLZ-1002', '北川陈家坝雨量站', '涪江', '60')], '测试员')
check('已撤除/末态不影响在册; 完全重复仍忽略', r7.duplicate + r7.updated + r7.accepted, 1)
const removed = listRows('rain').find((row) => Number(row.id) === faultId)!
check('撤除站状态保持已撤除', removed.status, '已撤除')
const reactivate = batchOnboard([
  d(String(removed['站号']), String(removed['站点名称']), '涪江', '88'),
], '测试员')
check('已撤除站重新提交不复活(重复忽略)', reactivate.duplicate, 1)
check('已撤除站阈值不被改', listRows('rain').find((row) => Number(row.id) === faultId)!['阈值雨量'], removed['阈值雨量'])

// 9) 待安装→运行正常 合法
const r8 = transitionStation(pendingInstallId, '提交安装', '测试员')
check('提交安装合法', r8.ok, true)

// 10) 阈值最小值只统计有效数值（38 那行因阈值无效被退回、不在册；最小为 40）
check('阈值最小值(mm)', minThreshold(), 40)

// 11) 会商核销待核故障站
const pending = listPendingFaults()[0]
verifyFault(pending.id, '复核属实')
check('核销后待核数减少', listPendingFaults().length, normalIds.length - 1)

// 12) 前一行退回不占站号：同站号资料齐全仍可上账
const r9 = batchOnboard([
  d('YLZ-3001', '退回先行走', '嘉陵江', 'abc'),
  d('YLZ-3001', '旺苍水磨沟站', '嘉陵江', '42'),
], '测试员')
check('退回不占位, 后行可上账', r9.returned === 1 && r9.accepted === 1, true)

if (failures) {
  console.error(`\n${failures} 条断言失败`)
  process.exit(1)
}
console.log('\n全部断言通过')
