/** Copy for the More menu rows: navigation actions, and Creator draft prompts per region. */
export const en = {
  install: 'Browse other plugins',
  create: 'Create your plugin',
  'createPrompt.sidebar': 'Create a DSH plugin with a left sidebar entry.',
  'createPrompt.conversation': 'Create a DSH conversation view plugin.',
  'createPrompt.rightbar': 'Create a DSH plugin with a right sidebar entry.',
} as const

/** Chinese counterpart of the entry-customization dictionary. */
export const zh: Record<keyof typeof en, string> = {
  install: '浏览更多插件',
  create: '创建你的插件',
  'createPrompt.sidebar': '创建一个带左侧栏入口的 DSH 插件。',
  'createPrompt.conversation': '创建一个 DSH 会话视图插件。',
  'createPrompt.rightbar': '创建一个带右侧栏入口的 DSH 插件。',
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  'install': '他のプラグインを探す',
  'create': 'プラグインを作成',
  'createPrompt.sidebar': '左サイドバーにエントリを持つ DSH プラグインを作成します。',
  'createPrompt.conversation': 'DSH 会話ビュープラグインを作成します。',
  'createPrompt.rightbar': '右サイドバーにエントリを持つ DSH プラグインを作成します。',
} satisfies Record<keyof typeof en, string>
