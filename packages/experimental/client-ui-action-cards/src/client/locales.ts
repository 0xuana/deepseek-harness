/** English card frame, fallback and tool-row copy. */
export const en = {
  expandBrief: 'Show more', collapseBrief: 'Show less',
  dismiss: 'Not now', dismissed: 'Dismissed', replaced: 'Replaced',
  unavailable: 'This action is unavailable. Check the plugin in Plugins.',
  transport: 'Could not confirm the result. Reconnect and check the card before retrying.',
  'row.title': 'Action card', 'row.preparing': 'Preparing a card', 'row.running': 'Proposing',
  'row.ok': 'Proposed', 'row.error': 'Not shown', 'row.stopped': 'Interrupted', 'row.inspect': 'Inspect call',
}

/** Keys shared by every dictionary. */
export type ActionCardKey = keyof typeof en

/** Chinese card frame, fallback and tool-row copy. */
export const zh: Record<ActionCardKey, string> = {
  expandBrief: '展开', collapseBrief: '收起',
  dismiss: '暂不需要', dismissed: '已忽略', replaced: '已替换',
  unavailable: '暂时无法执行，请到插件页面查看',
  transport: '暂时无法确认结果，请重新连接并查看卡片状态后再重试',
  'row.title': '操作卡片', 'row.preparing': '正在准备卡片', 'row.running': '正在提议',
  'row.ok': '已提议', 'row.error': '未显示', 'row.stopped': '已中断', 'row.inspect': '查看调用',
}

/** Japanese card frame, fallback and tool-row copy. */
export const ja: Record<ActionCardKey, string> = {
  expandBrief: 'すべて表示', collapseBrief: '折りたたむ',
  dismiss: '今はしない', dismissed: '却下済み', replaced: '置き換え済み',
  unavailable: 'この操作は利用できません。プラグイン画面でプラグインを確認してください。',
  transport: '結果を確認できませんでした。再接続してカードを確認してから再試行してください。',
  'row.title': 'アクションカード', 'row.preparing': 'カードを準備中', 'row.running': '提案中',
  'row.ok': '提案済み', 'row.error': '表示されませんでした', 'row.stopped': '中断されました', 'row.inspect': '呼び出しを確認',
}
