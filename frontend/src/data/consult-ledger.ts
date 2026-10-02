import type { LedgerEntry } from './types'

// 专家会商台账：雨量站网每次提交的结果都会落进来；设备故障整组上报时，
// 再添记「待核故障站」，等专家会商逐条核销。
const STORAGE_KEY = 'geohazard-patrol:consult-ledger'

function readStorage(): LedgerEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as LedgerEntry[]
  } catch {
    return []
  }
}

let cache: LedgerEntry[] | null = null

function entries(): LedgerEntry[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries()))
  }
}

function nextId(): number {
  return entries().reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export function listLedger(): LedgerEntry[] {
  return [...entries()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function listPendingFaults(): LedgerEntry[] {
  return listLedger().filter((item) => item.type === '待核故障站' && !item.verified)
}

export function appendLedger(
  input: Omit<LedgerEntry, 'id' | 'createdAt' | 'verified'> & { verified?: boolean },
): LedgerEntry {
  const entry: LedgerEntry = {
    id: nextId(),
    createdAt: new Date().toISOString(),
    verified: input.verified ?? false,
    ...input,
  }
  entries().push(entry)
  persist()
  return entry
}

/** 专家会商核销一条待核故障站。 */
export function verifyFault(id: number, note: string): LedgerEntry | null {
  const target = entries().find((item) => item.id === id)
  if (!target || target.type !== '待核故障站') {
    return null
  }
  target.verified = true
  target.verifiedAt = new Date().toISOString()
  target.verifiedNote = note.trim() || '现场复核设备已故障，安排检修'
  persist()
  return target
}
