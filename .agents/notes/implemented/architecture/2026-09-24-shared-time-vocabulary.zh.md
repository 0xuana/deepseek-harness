# Agent Note: 面向墙钟选择器的共享时间词汇

Status: implemented

[English](2026-09-24-shared-time-vocabulary.md) | 中文

## Problem

`dsh-util-time` 此前只承担一项职责、面向一种调用方：`canonicalClientTimeZone` 在协议边界校验调用方所报时区并回答 `undefined`，由 `dsh-api-session-controller` 与 `dsh-subagent` 映射成各自的域错误。同一套词汇的其余部分被另外两个消费方各自私下养大。Schedule 在 `packages/schedule/schedule/src/domain.ts` 里持有严格的 RFC 3339 时刻解析器、本地日历解析器、四位年份边界与规范格式化、本地墙钟解析，以及自己的 IANA 时区规范化实现——它抛 `ScheduleInputError` 而不是回答结果。`dsh-time-context` 在 `packages/context/time-context/src/request-zone.ts` 里持有第二份 IANA 时区剖面，配有自己的正则与自己的 `Intl.DateTimeFormat` 规范化，用来执行更严格的策略：一轮请求只能报出另一个进程会解析回同一标识的时区。因此 IANA 剖面与那一步 `Intl` 规范化合计存在三份，该剖面的任何变更都要逐份改、逐份验；而下一个需要墙钟选择器的消费方没有共享入口可用。

## Decision

`dsh-util-time` 拥有各边界所接收的时间词汇。它位于 `packages/util/time/src/instant.ts`，`src/index.ts` 转出它，并保留 `canonicalClientTimeZone` 作为既有协议边界消费的 `string | undefined` 包装。

本库回答带判别值的结果，不持有失败词汇。`parseOffsetInstant`、`fourDigitYearEpoch`、`parseLocalCalendar` 与 `canonicalizeTimeZone` 回答 `accepted` 分支，或回答携带稳定原因的 `rejected` 分支（`not_rfc3339`、`out_of_range`、`not_a_calendar_date`、`invalid_numeric_offset`、`malformed`、`blank`、`padded`、`not_area_location`、`unsupported`、`not_canonical_shape`）。每个调用方把原因映射成自己的错误码与诊断文案，因此本库从不撰写面向模型的文本。`formatFourDigitYearInstant` 返回规范时刻文本，越界时返回 `undefined`；`isFourDigitYearInstant` 回答某个纪元是否可表示；`resolveLocalInstant` 回答纪元毫秒，对落在前向跳变缺口内的墙钟值回答 `undefined`。两个严格解析器的原因词汇彼此对称：同一条件在两者中都叫 `out_of_range`，而 `LocalCalendarTime.year` 说明了二者中谁拒绝年份 0（`parseLocalCalendar`）、谁接受它（`resolveLocalInstant`，其调用方需要在 UTC 边界推导本地日期）。

Schedule 消费它，并保留全部域内决策。`canonicalizeTimeZone`、`decodeInstant`、`parseAtInput` 与 `futureInstant` 仍是 Schedule 的入口，保留既有错误码与诊断文案；它们现在调用共享解析器并映射其原因。Schedule 仍拥有持久记录结构、折叠与状态转移权威、抗注入的框架文本，以及全部重复规则运算：cron 引擎、每日与每周日期遍历、最近到期搜索，以及 Schedule 特有的决策时刻边界。

`dsh-time-context` 同样消费它，并保留自己更严格的策略。`deriveBrowserTimeZoneContext` 通过 `canonicalizeTimeZone` 读取每条 user-rpc 时区，并拒绝规范答案与所报值不同的别名，因此请求边界仍然要求另一个进程能解析回同一名称。三条拒绝与它们的文案归 time-context 所有；共享入口只回答规范名称或一个原因；被拒绝的结果中只有 `unsupported` 会携带本库捕获到的平台错误，使该拒绝在两个消费方都保留其 `cause`。

受维护的 `@js-temporal/polyfill` 0.5.1 在成为 `dsh-schedule` 运行时依赖之外，也成为 `dsh-util-time` 的运行时依赖。本地解析继续使用它，因此缺口与重叠仍由宿主 IANA 数据决定，也没有调用方需要自己实现偏移采样。`util/time` 的 README 与包描述删去了新增依赖所否定的 `zero-dependency` 表述。

可观察行为不变。每个被接受的输入解析出相同的纪元值，每个被拒绝的输入抛出相同的 `ScheduleInputError` 或 `ScheduleLogError` 错误码与相同的消息，存储的 `scheduledAt` 剖面不变，因此没有持久记录或录制快照需要重录。Schedule 其余测试只断言错误码，因此本次在 `packages/schedule/schedule/tests/domain.spec.ts` 新增的断言是唯一固定这三条本地日历消息的地方。`packages/util/time/tests/instant.spec.ts` 直接覆盖新增入口，包含逐文件 100% 覆盖。

## Alternatives considered

**把共享模块保持为 Schedule 私有。** 在 `domain.ts` 旁抽出一个 Schedule 私有的 `time` 模块可以缩小它，而不触碰已发布包、其 lockfile 条目、README 或依赖集合。之所以否决，是因为本次要消除的重复是重复的**剖面**，不是重复的行数：时区正则、`Intl` 规范化步骤与时刻剖面仍会存在两份，下一个接收墙钟选择器的边界仍会复制出第三份。

**让本库自带错误类型。** 一个携带原因的 `TimeInputError` 可以让调用方直接重抛而不做映射，缩短每个调用点。之所以否决，是因为 `util/time` 既有契约规定每个边界拥有自己的拒绝词汇，而 Schedule 的消息会通过工具结果的 `{ code, message }` 与客户端的消息卡片到达模型；共享错误类会把一个调用方的措辞带进另一个调用方的界面。

**让本库回答 `undefined` 而不是原因。** 这正是 `canonicalClientTimeZone` 已有的形态，也是改动更小的做法。之所以否决，是因为 Schedule 必须区分格式错误的时刻、日历上不存在的日期与越界时钟字段，才能保留既有诊断；`canonicalizeTimeZone` 也必须区分名称本身不合法与本地无法解析。把二者压成一个假值，会迫使 Schedule 用自己的正则重新推导这层区分，从而恢复重复。

**同时为其他消费方加入格式化与 DST 运算。** 目前没有消费方需要本库提供面向模型的格式化或偏移运算：`dsh-time-context` 自己拥有格式化器与时区策略文本。现在加入只会给本库一个没有消费方证据的公开操作集合，违背"每项抽象都绑定当前所有者与需求"的包规则。

## Consequences

时间剖面现在只有一个归宿。时刻剖面或时区剖面的变更只做一次、只覆盖一次，新边界导入它而不是复制它。Schedule 的 `domain.ts` 去掉了为时刻、日历日期、本地时间与时区剖面命名的五段正则、`Intl` 规范化与手写日历换算。它保留了用于 UTC 边界日期运算的两个边界常量，并把每处可表示性守卫委托给 `isFourDigitYearInstant`，因此范围本身只有一个所有者。

代价是更宽的已发布接口与更重的依赖图：`dsh-util-time` 增加了对 `@js-temporal/polyfill` 的运行时依赖，因此只导入 `canonicalClientTimeZone` 的消费方也会加载该模块。本库也不再是纯"只做校验与规范化"的包——其 README 与包描述必须说明这一点，其"已知限制"一节现在也记录了它。Schedule 在每个入口保留一层薄映射。本地日历与时刻映射函数以 `never` 默认分支穷尽 switch 本库的封闭原因联合，因此新增原因会让这两个调用点构建失败，而不是静默走兜底分支。时区映射函数则只对 `not_canonical_shape` 分支——当前 IANA 数据不会产生该原因，因此它由 `v8 ignore` 守护而不是 `never` 默认分支——并把 `blank`、`padded`、`not_area_location` 与 `unsupported` 合并成一条诊断。因此日后给 `TimeZoneRejection` 新增原因时会通过编译并静默套用那条通用文案。

本次未触及、仍归 time-context 的两项：`packages/context/time-context/src/timestamp.ts` 中的 ISO 形状时间戳渲染（那是该包的持久读数字格式），以及其插件内的耗时措辞。浏览器客户端也保留自己的本地化日期渲染与自己的 UTC 偏移读取——它们服务的目的（读者的区域设置）与边界值不同；统一它们意味着先决定共享库是否也要拥有展示格式化，以及届时由谁拥有其不变量所校验的持久读数字格式。`packages/session/session-format-v0-to-v1/src/payload-validation.ts` 也用自己的一段正则与往返比对校验规范的四位年份 UTC 时刻，这是本次未触及、仍然存在的时刻剖面副本。
