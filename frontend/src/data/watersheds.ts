// 所属流域的唯一取数口：批量上账表单、列表筛选等所有入口都从这里拿名录，不各取各的。
// 名录要调整只改这一处，各入口自动保持一致。
const WATERSHEDS = [
  '岷江流域',
  '沱江流域',
  '涪江流域',
  '嘉陵江流域',
  '渠江流域',
  '青衣江流域',
  '大渡河流域',
  '安宁河流域',
]

export function listWatersheds(): string[] {
  return [...WATERSHEDS]
}
