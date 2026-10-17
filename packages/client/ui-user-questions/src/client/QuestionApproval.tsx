/** Fixed-action question presentation using the shared approval card. */
import type { AskUserQuestionItem, AskUserQuestionIntent } from '@deepseek-ai/dsh-user-questions/types'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { QuestionComposerProps } from './contract/slots.ts'

/**
 * Keep the question answer channel while rendering permission choices without a text field.
 * @param props Blocking question, its approval presentation and renderer bindings.
 * @returns The shared approval card with exactly the caller's offered actions.
 */
export function QuestionApproval(props: QuestionComposerProps & {
  item: AskUserQuestionItem
  intent: Extract<AskUserQuestionIntent, { kind: 'approval' }>
}) {
  const { matched: pending, item, intent, resolveText } = props
  const always = intent.always
  const answer = (label: string) => pending.answer({ answers: [{ id: item.id, selected: [label] }] })
  return props.renderFactorySlot('conversation.approval.card', {
    requestKey: pending.key,
    title: intent.display === undefined ? item.question : resolveText(intent.display.question),
    ...(item.detail === undefined ? {} : {
      description: intent.display?.detail === undefined ? item.detail : resolveText(intent.display.detail),
    }),
    ...(intent.subject === undefined ? {} : { subject: intent.subject }),
    allowLabel: intent.display?.approve === undefined ? intent.approve : resolveText(intent.display.approve),
    canAnswer: () => pending.snapshot().channel !== 'none' && !pending.snapshot().closed,
    onAllow: () => answer(intent.approve),
    onReject: () => answer(intent.reject),
    ...(always === undefined ? {} : { onAlways: () => answer(always) }),
  })
}
