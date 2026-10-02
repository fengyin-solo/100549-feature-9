import type { RainDraft } from './types'

// 搁置箱：站点名称或所属流域缺失（或站号已在册、名称对不上）的行先放在一旁，
// 不拦住同批其他行；补齐后可以从这里再次提交。
const STORAGE_KEY = 'geohazard-patrol:rain-held-drafts'

function readStorage(): RainDraft[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as RainDraft[]
  } catch {
    return []
  }
}

let cache: RainDraft[] | null = null

function drafts(): RainDraft[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts()))
  }
}

export function listHeldDrafts(): RainDraft[] {
  return drafts()
}

/** 同站号覆盖：搁置箱里同一站号只留最新一版。 */
export function upsertHeldDraft(draft: RainDraft): void {
  const rest = drafts().filter((item) => item.code !== draft.code)
  rest.push(draft)
  cache = rest
  persist()
}

export function upsertHeldDrafts(incoming: RainDraft[]): void {
  const byCode = new Map(drafts().map((item) => [item.code, item]))
  for (const draft of incoming) {
    byCode.set(draft.code, draft)
  }
  cache = [...byCode.values()]
  persist()
}

export function removeHeldDraft(uid: number): void {
  cache = drafts().filter((item) => item.uid !== uid)
  persist()
}
