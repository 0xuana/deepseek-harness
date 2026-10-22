# Agent Note: Session 历史快照、纯监听与 Web Follow 聚合

Status: proposed

## Problem

历史的一次读取、实时事件订阅和 Web 开场聚合需要不同的生命周期。若纯监听也读取 Observation 来计算起点，订阅就引入不必要的历史读取；若聚合层另建历史读取模块，又会让标准接口与 Web 各自拥有一条读取路径。需要明确资源持有和接续顺序，使历史快照与实时事件能组合而不重复读取、不遗漏开场期间的事件。

## Proposal

在 session-controller 包内保留并行的 `NewSessionController`（`newSession`）与 `NewWebController`（`newWeb`）。旧 `SessionController`、旧客户端与旧 API 不变；新接口仅交付 History Record，不包含 header、projection、assistant stream 或 activate/resume。

### 职责与接口

| 所有者 | 职责 | 不承担的工作 |
|---|---|---|
| `NewSessionController.history` | 取得 Observation，执行 `paginate`、`pageRecords`，返回 `{ cursor, records, hasMore }`，随后释放租约 | 不监听事件、不激活 |
| `NewSessionController.observeHistory` | 创建 Listener，发出无 cursor 的 `ready`，转发 `listener.events()` | 不读取历史、不取得 Observation |
| `NewWebController.follow` | 先创建 Listener，再在 Host 内直接调用 `ctx.newSessionController.history`，发 snapshot 后转发 `eventsAfter(cursor)` | 不另建 `historyRead` 模块、不经 RPC 调用标准方法 |
| `HistoryListener` | 注册 `session/event` 和 `session/created` 适配，缓冲、去重、检查连续性，以 `entryFor` 转为事件帧并输出，关闭时释放监听 | 不取得或持有 Observation、不补读快照、不激活 |

`history` 接收 `address`、可选的 `throughSeq`、`beforeSeq` 与分页预算。不传 `throughSeq` 时，返回的 cursor 是本次 Observation 的末尾；传入时必须是该 Observation 可读取的有效点位。`beforeSeq` 只选择更早的页面，不替代基准 cursor；返回 cursor 不等于旧页最后一条记录的位置。`follow` 只接收 address 和开场分页预算，不接受旧 `throughSeq` 或 `beforeSeq`，开场读取当前点位的最新页。

复用已有 [SessionObservation](../../../../packages/session-query/session-query/src/observation.ts) 定义及 [Observation 决策](../../implemented/architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)，不引入来自 #4107 的新概念。`acquireObservation` 仅表示现有 `sessionQuery.observeSession` 加地址校验与错误映射；租约只在 `history` 方法生成返回值期间持有，不转交给 Listener，也不绑定流的整个生命周期。

### 三个入口

以下是职责示意，不作为可编译声明。`resolveHistoryRequest` 表示入口的参数校验和显式默认值处理；请求取消在读取完成后、返回结果前再次检查。

```text
// NewSessionController
async history(request, signal) {
  const spec = resolveHistoryRequest(request)
  using observation = await acquireObservation(this.ctx, spec.address, signal)
  signal.throwIfAborted()
  const cursor = spec.throughSeq ?? observation.cursor
  validateHistoryCut(cursor, observation.cursor)
  const page = paginate(
    observation.events, spec.beforeSeq, spec.maxMessages, cursor, spec.turnWindow,
  )
  return { cursor, records: pageRecords(page.events), hasMore: page.hasMore }
}
```

```text
// NewSessionController
async *observeHistory(request, signal) {
  using listener = new HistoryListener(this.ctx, request.address, signal)
  yield { type: 'ready' }
  yield* listener.events()
}
```

```text
// NewWebController
async *follow(request, signal) {
  using listener = new HistoryListener(this.ctx, request.address, signal)
  const opening = await this.ctx.newSessionController.history(request, signal)
  yield { type: 'snapshot', ...opening }
  yield* listener.eventsAfter(opening.cursor)
}
```

### Listener 与快照接续

Listener 构造完成时已同步挂好事件监听并开始缓冲。`events()` 和 `eventsAfter(C)` 是同一个缓冲的两种单消费者选择，一次 Listener 生命周期只能选择并消费其中一种；不增加 `align` 或第二次初始化。两者返回异步事件帧序列，生成器延迟到首次迭代才执行，不影响构造时已开始的监听与缓冲。

- `events()` 输出订阅生效后收集的事件，以首个可输出事件建立序列起点，之后去重并检查连续性；不承诺交付订阅前的历史。
- `eventsAfter(C)` 丢弃 `seq ≤ C` 的事件，第一条必须是 `C + 1`，随后保持连续；尚未收到下一条时等待，遇到缺号则明确结束并报告错误，不静默跳过或补读。
- `session/created` 适配负责把构造期未逐条广播的种子事件纳入同一输入。这不调用 Observation，也不补读持久化快照；实现必须覆盖生成器尚未开始消费时发生创建的情况，不能依赖提前执行生成器来避免丢失。

例如 Listener 首先收到 15，读取 History 期间已缓冲 15～20，而 History 返回 `cursor = 20`。Follow 先发覆盖到 20 的 snapshot，再由 Listener 丢弃缓冲中重复的 15～20，从 21 开始输出增量。丢弃的是监听缓冲中的重叠，不是快照里的记录；不把快照故意截回 14。快照按页交付，更早记录仍通过 History 分页读取。

### Ready、授权与释放

`ready` 只确认该流的监听已安装，不包含 cursor，不证明会话存在、子会话身份已经验证或 Agent 就绪。独立组合接口的调用方持续消费并缓冲流，收到 ready 后再请求 History，应用历史页后按返回 cursor 丢弃重复增量；这保证远端请求顺序不会把读取排在监听生效之前。

Remote 方法继续声明现有 `resources` 会话授权；Host 内部直接调用不代替对 `follow` 入口本身的授权。纯流如何在不调用 Observation 的情况下完成子会话身份验证，是实现前必须核实的安全项，本提案不指定替代校验机制；不能把 ready 当成授权证据，也不能在必要身份校验未完成时输出事件数据。

History 成功、失败或取消都释放已取得的 Observation。流结束、调用方取消、插件卸载、历史读取失败及事件处理错误都必须撤销监听、释放缓冲并唤醒等待者；部分监听注册失败也必须清理已注册部分。Listener 不因没有新事件而阻止取消完成。

### 与既有决策及后续范围的关系

[历史与 Remote 事件传输决策](../../implemented/architecture/2026-08-18-session-history-and-event-transport.zh.md)继续拥有旧 API、传输生命周期与客户端恢复行为；[Observation 决策](../../implemented/architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)继续拥有精确读取和 projection 状态。两篇仍有独立作用，本提案不替代或归档它们。

History-only `newWeb.follow` 不是旧完整 Web 协议的直接替换；旧客户端迁移不在本阶段。Projection 下一阶段先讨论独立接口，再讨论 Follow 多数据聚合与同游标问题；本提案不预设共享 Observation、projection revision 或其他对齐方案。

## Alternatives considered

**先读历史，再开 tail 补读缺口。** 不采用；先安装监听就能覆盖读取期间的增量，不需要额外历史读取或任意旧游标续传能力。

**纯监听取得 Observation 并返回 ready.cursor。** 不采用；监听只需要确认订阅生效，历史点位由独立 History 返回。

**另建 historyRead 模块或让 Listener 持有 Observation。** 不采用；标准 History 方法已经拥有一次读取，Listener 仅按结果 cursor 消费缓冲，二者无需共享资源所有权。

## Acceptance criteria

- History 一次调用取得一份 Observation，返回与该读取一致的 cursor、records、hasMore；覆盖显式点位、最新点位、空历史、非法点位及旧页分页。
- 纯监听不调用 Observation 或激活路径；ready 不含 cursor，始终先于事件帧，事件去重并保持已建立起点之后的连续性。
- Follow 的监听注册先于 History 调用，且仅调用一次标准 History；开场第一帧是 snapshot，重叠例子中第一条增量为 21，生成器延迟消费期间的事件不丢失。
- 覆盖监听期间 Session 创建、种子事件与普通通知重复、缺号、取消、消费者结束、读取失败及插件卸载；断言租约、监听与等待者全部释放。
- 实现前核实纯流子会话身份验证；拒绝错误父子关系或身份不符的地址，不能以 ready 或 child id 过滤替代授权。Host 集成测试覆盖真实资源授权与直接方法调用路径。
- 新增无密钥快照用例固定 history-only 的开场与增量输出；旧 API 与旧客户端的协议、激活行为保持不变。测试结果与类型检查在实现阶段提供，本提案不代表现有示例代码已通过验证。

## Risks

- 纯流不提供历史起点或存在性结论；调用方必须正确理解 ready，并在需要历史时按先订阅后读取的顺序组合。
- 开场读取慢或消费者停止拉取会积累缓冲。实现前需核实项目既有背压与容量策略；不能通过静默丢事件维持连接，本提案不新增容量配置。
- 子会话身份校验和 `session/created` 在消费开始前的适配必须完成验证，不能因为新入口更短而削弱数据访问控制或事件完整性。
- 新旧接口并行保留有暂时维护成本；命名相近不表示新 Follow 已提供旧 Web 的全部数据或副作用。
