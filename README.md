# dsh-auto-review-default

[English](README.en.md) | 中文

把会话放进内置的 `auto` 权限预设（Auto review）：**新建会话在创建时进入**，**已有的根会话在重新打开（恢复）时切过去**。

委托给子代理产生的子会话不会被改动——它们的权限由父会话的委派固定，而且 Auto 的 `ask` 策略会让子会话的审批在委派过程中弹给人。

## 它解决什么

DSH 官方有意不让 Auto 成为默认值，两处文档原文：

- `@deepseek-ai/dsh-permission-presets`：「**Auto 不能成为默认值**——它只在 integration effect 存活期间存在，并且有意不进入 `permission` 设置 schema。」
- `@deepseek-ai/dsh-client-ui-permission-presets`：「设置行……`auto` 等仅限当前会话的 contribution 不会出现」「**Auto review 仅限当前会话**」。

结果是通用设置的权限下拉永远只有配置表里的预设，Auto 必须一个一个会话手动切（输入框的权限控件，或 `/permission auto`）。

安装前必须已有 `@deepseek-ai/dsh-experimental-auto-review`（官方随附的实验层）；它在启用状态时本插件才有可切换的目标。

## 安装

```sh
dsh plugin --profile web add github:devil233-ui/dsh-auto-review-default
```

把 `web` 换成你自己的 profile 名（DSH Desktop 用的是 `desktop`）。装完宿主会热加载，不必重启。

## 它怎么工作

宿主里唯一决定「会话初始权限」的地方是 `PermissionPresetService#pinInitialPermission(session)`：服务自己的 `session/created` 监听器**对每一个进入 store 的会话**都调它（新建的、恢复的都算），挂载时还会对存量会话各调一次。本插件只包这一个方法：调用原方法之后，若该会话不是委托子会话且当前不在 `auto`，就经官方 `permissionPresets.set` 切到 `auto`。挂在同一个方法上才能在原方法写入任何事件**之前**读到 `session.seq === 0`，从而区分「新建」与「恢复」（只影响日志措辞，采纳与否不依赖它）。

这确实是对宿主内部方法的包装，不是官方扩展点；取舍见下方「已知限制」。

**装载时已经活着的会话故意不动**：插件只在「创建」与「恢复」两个时点动作，所以你正开着的会话会保留它当前的预设，直到它被重新打开。

## 安全性质

- **永不抛出**。`session/created` 里的同步异常会否决并回滚会话创建，所以这里任何失败都降级为「保持会话当前预设」，只写一行警告日志。
- **不碰委托子会话**：`dsh-subagent` 会给子会话打 `origin: "subagent"` 与正的 `delegationDepth`（根会话持久化后是 `delegationDepth: 0`，所以只有正数才算子会话）。header 读不出来时一律当作子会话处理，不做猜测。
- **不碰定时任务运行器的会话**：`@michengai/dsh-automation` 的运行会话 id 以 `dsh-automation-session-` 开头，任务创建时自带无人值守预设（通常 `approval: never`），切到 Auto 会把每一步都变成无人应答的授权弹窗（v0.2.0 的实际事故，v0.2.1 修复）。
- **幂等**，并通过 Cordis effect 的 disposer 可逆；在 Auto 不可用（实验层未启用）时自动降级。

## 验证记录

在隔离的 `headless` profile 里用一次性任务实测，读会话投影缓存的 `permissions` 值：

| 场景 | 结果 |
|---|---|
| 装插件后新建会话 | `preset: "auto"`（sandbox `danger-full-access` + approval `ask`） |
| 不装插件新建会话（基线） | `preset: "workspace-write"` |
| **装插件后恢复那个基线会话** | **`preset: "auto"`**（恢复时切换） |
| 模型起子代理产生的子会话 | 插件未采纳（探针实测 `isChild=true` 被拦下）；子会话上的 `permission/preset auto` 是 `dsh-subagent` 自己把父会话预设拷进去的 |
| `dsh-automation-session-*` 运行会话 | 插件不采纳，保持任务自带的无人值守预设（v0.2.1） |

在 DSH Desktop `0.2.0-rc.2` 上验证。

## 卸载

```sh
dsh plugin --profile web remove dsh-auto-review-default
```

## 已知限制

- **恢复旧会话时会一律切到 Auto**，包括你曾经显式设成「仅可查看」或「工作区内修改文件」的会话——它会把沙箱放宽到 `danger-full-access`（同时加上逐调用审查）。这是有意的选择，不是副作用；如果你只希望新会话走 Auto，就别装这个插件，或者把 `adopt()` 里的判定收窄。
- **Auto 是实验功能**：可能误放行不安全动作、误拒有用操作，并让每次工具调用多一次模型请求（不缓存、不重试）。本插件只把它设成默认，不改变它的行为。
- **包装的是宿主内部方法名**。DSH 升级若重命名 `pinInitialPermission`，插件会**静默失效**（会话保持各自当前预设），不会报错也不会弄坏启动。升级后若发现新会话不再进 Auto，先查这里。
- 依赖 `@deepseek-ai/dsh-experimental-auto-review` 处于启用状态；它缺失时本插件自动降级。
- 不做按工作区或按 Agent 的细分规则；要那种粒度请用 [`dsh-workspace-tools`](https://github.com/AHIOSUZ/dsh-workspace-tools)（但它目前只允许三个内置预设，不含 `auto`）。

## 许可

MIT
