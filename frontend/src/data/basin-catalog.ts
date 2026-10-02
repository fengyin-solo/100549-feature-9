// 所属流域统一目录：所有入口（批量上账、单站登记、故障上报等）都从这里取数，
// 不允许各页面各写一份、各取各的。
//
// 流域名单来自多个上游入口（水文遥测目录、汛期预案、人工补录），在这里
// 合并、去重、排序后统一对外。上游可能是同步表也可能是异步接口，因此取数
// 做了单次缓存，多个入口同时取也只合并一次。

type BasinSource = {
  entry: string
  fetch: () => string[] | Promise<string[]>
}

// 三个取数入口：对应不同上游，名称做了 trim，故意保留重复项以验证去重。
const SOURCES: BasinSource[] = [
  { entry: '水文遥测目录', fetch: () => ['长江上游', '嘉陵江', '岷江', '沱江', '乌江'] },
  { entry: '汛期防汛预案', fetch: () => ['嘉陵江', '渠江', '涪江', '大渡河'] },
  { entry: '人工补录名册', fetch: () => ['金沙江', '岷江', '青衣江'] },
]

function normalize(name: string): string {
  return name.trim()
}

function mergeBasins(sources: string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const list of sources) {
    for (const raw of list) {
      const name = normalize(raw)
      if (!name || seen.has(name)) {
        continue
      }
      seen.add(name)
      result.push(name)
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

let cached: Promise<string[]> | null = null

/** 统一取数：合并所有入口并去重，重复调用复用同一次结果。 */
export function fetchBasins(): Promise<string[]> {
  if (cached === null) {
    cached = Promise.all(SOURCES.map((source) => Promise.resolve().then(source.fetch)))
      .then(mergeBasins)
      .catch(() => [] as string[])
  }
  return cached
}

/** 同步侧（如静态下拉）使用的初始名单：异步合并完成前的兜底，取全部入口并集。 */
export function basinSnapshot(): string[] {
  return mergeBasins(SOURCES.map((source) => source.fetch() as string[]))
}

export const basinEntries: string[] = SOURCES.map((source) => source.entry)
