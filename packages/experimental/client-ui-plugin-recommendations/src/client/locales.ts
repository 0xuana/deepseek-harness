/** Typed product copy for recommendation cards. */
export const zh = {
  heading: '推荐插件',
  official: '官方',
  enable: '启用',
  dismiss: '暂不需要',
  enabling: '正在处理…',
  scope: '启用后可在所有会话中使用',
  applied: '已启用',
  dismissed: '已忽略',
  'restart-required': '已保存，重启 DSH 后生效',
  overridden: '已保存，但被其他配置覆盖。请在插件页检查。',
  failed: '启用失败。可重试或在插件页检查。',
  cancelled: '操作已取消，可以重试。',
  retry: '重试启用',
  unavailable: '插件状态已变化，请在插件页检查。',
  unknown: '找不到这条推荐，请重新打开会话。',
  'access-denied': '没有修改此配置的权限。',
  'not-live-root': '请在原会话中操作这条推荐。',
  closing: '服务正在重载，请稍后重试。',
  transport: '无法确认操作结果，请刷新后重试。',
} satisfies Record<string, string>

/** Keys shared by both card dictionaries. */
export type RecommendationKey = keyof typeof zh

/** English card copy. */
export const en = {
  heading: 'Recommended plugin',
  official: 'Official',
  enable: 'Enable',
  dismiss: 'Not now',
  enabling: 'Working…',
  scope: 'Available in all conversations when enabled',
  applied: 'Enabled',
  dismissed: 'Dismissed',
  'restart-required': 'Saved. Restart DSH to apply.',
  overridden: 'Saved, but another configuration overrides it. Check Plugins.',
  failed: 'Could not enable. Retry or check Plugins.',
  cancelled: 'Cancelled. You can retry.',
  retry: 'Retry enabling',
  unavailable: 'This plugin has changed. Check Plugins.',
  unknown: 'This recommendation is unavailable. Reopen the conversation.',
  'access-denied': 'You do not have permission to change this profile.',
  'not-live-root': 'Use this recommendation in its original conversation.',
  closing: 'The service is reloading. Try again shortly.',
  transport: 'Could not confirm the result. Refresh and try again.',
} satisfies Record<RecommendationKey, string>
