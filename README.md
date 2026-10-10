# dsh-auto-review-default

[English](README.en.md) | 中文

让**每个新建会话**默认进入内置的 `auto` 权限预设（Auto review），而不是 profile 配置里的默认预设。

## 它解决什么

DSH 官方有意不让 Auto 成为新会话默认值，两处文档原文：

- `@deepseek-ai/dsh-permission-presets`：「**Auto 不能成为默认值**——它只在 integration effect 存活期间存在，并且有意不进入 `permission` 设置 schema。」
- `@deepseek-ai/dsh-client-ui-permission-presets`：「设置行……`auto` 等仅限当前会话的 contribution 不会出现」「**Auto review 仅限当前会话**」。

结果是通用设置的权限下拉永远只有配置表里的预设，Auto 必须一个一个会话手动切（输入框的权限控件，或 `/permission auto`）。

装上前必须已有 `@deepseek-ai/dsh-experimental-auto-review`（官方随附的实验层）；它在启用状态时本插件才有可切换的目标。

## 安装

```sh
dsh plugin --profile web add dsh-auto-review-default        # 发布到 npm 后
dsh plugin --profile web add github:devil233-ui/dsh-auto-review-default
```

把 `web` 换成你自己的 profile 名（DSH Desktop 用的是 `desktop`）。装完**重启 DSH** 让宿主重新加载 bundle。

## 它怎么工作

宿主里唯一决定「会话初始权限」的地方是 `PermissionPresetService#pinInitialPermission(session)`：服务自己的 `session/created` 监听器和挂载时的存量会话扫描都调它。本插件只包这一个方法，因此比再注册一个 `session/created` 监听器更窄，也不依赖监听器的调用顺序——挂在同一个方法上才能**在原方法写入任何事件之前**读到 `session.seq === 0`，从而准确判断「这是全新会话」。

这确实是对宿主内部方法的包装，不是官方扩展点；取舍见下方「已知限制」。

## 安全性质

- **永不抛出**。`session/created` 里的同步异常会否决并回滚会话创建，所以这里任何失败都降级为「照常使用配置的默认预设」，只写一行警告日志。
- **只碰全新会话**（`session.seq === 0`，且 header 没有 `parentSession`、不是 `isSeeded`）。恢复、续聊、分叉、种子、委派子会话、已经在跑的会话一律不动。
- **幂等**，并通过 Cordis effect 的 disposer 可逆；在 Auto 不可用（实验层未启用）时自动降级。

## 验证记录

在隔离的 `headless` profile 里用一次性任务实测，读会话投影缓存的 `permissions` 值：

| 场景 | 结果 |
|---|---|
| 装插件后新建会话 | `preset: "auto"`（sandbox `danger-full-access` + approval `ask`） |
| 不装插件（基线） | `preset: "workspace-write"` |
| 装插件后续聊旧会话 | 仍是 `workspace-write`，未被改写 |
| 完整任务运行 | 正常返回，会话创建未被否决 |

在 DSH Desktop `0.2.0-rc.2` 上验证。

## 卸载

```sh
dsh plugin --profile web remove dsh-auto-review-default
```

重启后生效。当前处于 Auto 的会话不会被本插件改写权限。

## 已知限制

- **Auto 是实验功能**：可能误放行不安全动作、误拒有用操作，并让**每次工具调用多一次模型请求**（不缓存、不重试）。本插件只是把它设成默认，不改变它的行为。
- **包装的是宿主内部方法名**。DSH 升级若重命名 `pinInitialPermission`，插件会**静默失效**（回到普通默认预设），不会报错也不会弄坏启动。升级后若发现新会话不再默认 Auto，先查这里。
- 依赖 `@deepseek-ai/dsh-experimental-auto-review` 处于启用状态；它缺失时本插件自动降级。
- 不做按工作区或按 Agent 的细分规则；要那种粒度请用 [`dsh-workspace-tools`](https://github.com/AHIOSUZ/dsh-workspace-tools)（但它目前只允许三个内置预设，不含 `auto`）。

## 许可

MIT
