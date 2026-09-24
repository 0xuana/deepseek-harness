# Agent Note: 面向墙钟选择器的共享时间词汇

Status: implemented

[English](2026-09-24-shared-time-vocabulary.md) | 中文

## Problem

`dsh-util-time` 此前只承担一项职责、面向一种调用方：`canonicalClientTimeZone` 在协议边界校验调用方所报时区并回答 `undefined`，由 `dsh-api-session-controller` 与 `dsh-subagent` 映射成各自的域错误。同一套词汇的另一半则在 `packages/schedule/schedule/src/domain.ts` 内部私下生长：严格的 RFC 3339 时刻解析器、本地日历解析器、四位年份边界与规范格式化、本地墙钟解析，以及第二个 IANA 时区规范化实现——它抛 `ScheduleInputError` 而不是回答结果。由此产生两个后果。同样的三段正则与同样的 `Intl.DateTimeFormat` 规范化存在两份，任何一侧剖面变更都要改两遍、验两遍。而下一个需要墙钟选择器的消费方没有共享入口可用，这正是该剖面会被第三次复制而不是被导入的原因。

## Decision

`dsh-util-time` 拥有各边界所接收的时间词汇。它位于 `packages/util/time/src/instant.ts`，`src/index.ts` 转出它，并保留 `canonicalClientTimeZone` 作为既有协议边界消费的 `string | undefined` 包装。

本库回答带判别值的结果，不持有失败词汇。`parseOffsetInstant`、`fourDigitYearEpoch`、`parseLocalCalendar` 与 `canonicalizeTimeZone` 回答 `accepted` 分支，或回答携带稳定原因的 `rejected` 分支（`not_rfc3339`、`not_a_calendar_date`、`not_a_wall_clock_time`、`invalid_numeric_offset`、`malformed`、`out_of_range`、`blank`、`padded`、`not_area_location`、`unsupported`、`not_canonical_shape`）。每个调用方把原因映射成自己的错误码与诊断文案，因此本库从不撰写面向模型的文本。`formatFourDigitYearInstant` 返回规范时刻文本，越界时返回 `undefined`；`resolveLocalInstant` 回答纪元毫秒，对落在前向跳变缺口内的墙钟值回答 `undefined`。

Schedule 消费它，并保留全部域内决策。`canonicalizeTimeZone`、`decodeInstant`、`parseAtInput` 与 `futureInstant` 仍是 Schedule 的入口，保留既有错误码与诊断文案；它们现在调用共享解析器并映射其原因。Schedule 仍拥有持久记录结构、折叠与状态转移权威、抗注入的框架文本，以及全部重复规则运算：cron 引擎、每日与每周日期遍历、最近到期搜索，以及 Schedule 特有的决策时刻边界。

受维护的 `@js-temporal/polyfill` 0.5.1 在成为 `dsh-schedule` 运行时依赖之外，也成为 `dsh-util-time` 的运行时依赖。本地解析继续使用它，因此缺口与重叠仍由宿主 IANA 数据决定，也没有调用方需要自己实现偏移采样。`util/time` 的 README 与包描述删去了新增依赖所否定的 `zero-dependency` 表述。

可观察行为不变。每个被接受的输入解析出相同的纪元值，每个被拒绝的输入抛出相同的 `ScheduleInputError` 错误码与消息，存储的 `scheduledAt` 剖面不变，因此没有持久记录或录制快照需要重录。`packages/util/time/tests/instant.spec.ts` 直接覆盖新增入口，包含逐文件 100% 覆盖。

## Alternatives considered

**把共享模块保持为 Schedule 私有。** 抽成 `packages/schedule/schedule/src/time.ts` 可以缩小 `domain.ts`，而不触碰已发布包、其 lockfile 条目、README 或依赖集合。之所以否决，是因为本次要消除的重复是重复的**剖面**，不是重复的行数：时区正则、`Intl` 规范化步骤与时刻剖面仍会存在两份，下一个接收墙钟选择器的边界仍会复制出第三份。

**让本库自带错误类型。** 一个携带原因的 `TimeInputError` 可以让调用方直接重抛而不做映射，缩短每个调用点。之所以否决，是因为 `util/time` 既有契约规定每个边界拥有自己的拒绝词汇，而 Schedule 的诊断文案被 `tools.spec.ts`、快照期望与模型可见工具结果逐字固定；共享错误类会把一个调用方的措辞带进另一个调用方的界面。

**让本库回答 `undefined` 而不是原因。** 这正是 `canonicalClientTimeZone` 已有的形态，也是改动更小的做法。之所以否决，是因为 Schedule 必须区分格式错误的时刻、日历上不存在的日期与越界时钟字段，才能保留既有诊断；`canonicalizeTimeZone` 也必须区分名称本身不合法与本地无法解析。把二者压成一个假值，会迫使 Schedule 用自己的正则重新推导这层区分，从而恢复重复。

**同时为其他消费方加入格式化与 DST 运算。** 目前没有消费方需要本库提供面向模型的格式化或偏移运算：`dsh-time-context` 自己拥有格式化器与时区策略文本。现在加入只会给本库一个没有消费方证据的公开操作集合，违背"每项抽象都绑定当前所有者与需求"的包规则。

## Consequences

时间剖面现在只有一个归宿。时刻剖面或时区剖面的变更只做一次、只覆盖一次，新边界导入它而不是复制它。Schedule 的 `domain.ts` 去掉了三段正则、`Intl` 规范化、手写日历换算与四位年份边界运算。

代价是更宽的已发布接口与更重的依赖图：`dsh-util-time` 增加了对 `@js-temporal/polyfill` 的运行时依赖，因此只导入 `canonicalClientTimeZone` 的消费方也会加载该模块。本库也不再是纯"只做校验与规范化"的包——其 README 与包描述必须说明这一点，其"已知限制"一节现在也记录了它。Schedule 在每个入口保留一层薄映射，因此本库联合类型新增原因时，每个调用方都会因穷尽 switch 而构建失败，而不是静默走默认分支。

`dsh-time-context` 保留自己的 IANA 正则与规范化，不参与本次改动。它在请求边界拒绝非规范别名，而 Schedule 会把它规范化，因此统一二者意味着决定浏览器时区指令需要两种行为中的哪一种；该决定属于消费方，而不属于这次抽取。
