/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
import { memo, type ReactElement } from 'react'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'
import { RunningStatus } from './RunningStatus.tsx'

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, pendingInputs, lastInputTurn, deferCollapse,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
  useStore, actions, renderSlot, renderFactorySlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, inspectCall, forkAt, loadImage, fileMentions,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const running = useSession(snapshot => snapshot.running)
  const latestTurnAnchor = useChat(snapshot => snapshot.navigation.items().at(-1)?.anchorKey)
  const runningStartTime = useChatNode(latestTurnAnchor ?? '', (node) => {
    const location = node?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.status === 'open' ? location.turn.start?.time : undefined
      : undefined
  })
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, inspectCall, forkAt, loadImage, fileMentions,
  }
  const rows = entries.map((entry) => {
    switch (entry.kind) {
      case 'node':
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} />
      default:
        return assertNever(entry)
    }
  })
  // Transcript echoes open the running Turn and precede the status; steering
  // and Inbox echoes follow it, so the status stays on the running Turn's tail.
  const openingRows: ReactElement[] = []
  const pendingRows: ReactElement[] = []
  for (const item of pendingInputs) {
    if ('requestId' in item) {
      (item.placement === 'transcript' ? openingRows : pendingRows).push(
        <PendingSubmissionBubble key={item.requestId} submission={item}
          loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />,
      )
    } else {
      pendingRows.push(
        <PendingSteeringBubble key={item.id} content={item.content}
          loadImage={loadImage} renderFactorySlot={renderFactorySlot} t={t} />,
      )
    }
  }
  const tail = entries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows one local transcript echo, never steering.
  // All rows share this keyed list so inserting the control keeps the echo mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    const echo = openingRows.shift()
    if (echo !== undefined) rows.splice(rows.length - 1, 0, echo)
  }
  // Rows enter before the keyed status and echoes after it, so React never moves its DOM node.
  return [
    ...rows, ...openingRows,
    ...running ? [<RunningStatus key="running" startTime={runningStartTime} t={t} />] : [],
    ...pendingRows,
  ]
})
