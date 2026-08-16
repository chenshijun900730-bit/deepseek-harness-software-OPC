# 外部环境变更交接说明（发给 software-company harness 开发 Agent）

> 背景：你的开发过程中，宿主环境（DSH 服务、浏览器端）由外部协作者进行了排查与修复。以下是你需要知道的全部变更，请阅读后继续任务，**不要回退第 1 条的修复**。

## 1. 你的 client.js 已被外部修复：补上了模块注册（勿覆盖）

**文件**：`/Users/xiaowanzi/.dsh/.agent-presets/software-company/packages/company-r2/client.js`

**当时的问题**：原文件是自执行 IIFE，直接装面板、从不调用 `__ModuleLoader__.load`。DSH 的 client-modules 加载器要求每个 client bundle 在**脚本执行期**同步完成注册，否则报：

```
client-modules: bundle .../client.js?rev=... loaded without registering
".../company-r2" via __ModuleLoader__.load
```

该报错曾导致整个 Web UI 降级（"Failed to load plugins" 横幅 + 界面无法打开）。

**外部修复内容**（已验证生效）：
- 原面板安装体整体包成 `function installPanel() { ... }`（原有 `__COMPANY_PANEL_INSTALLED__` 防重入保留在函数内）
- 脚本执行期调用注册：

```js
window.__ModuleLoader__.load({
  id: '/Users/xiaowanzi/.dsh/.agent-presets/software-company/packages/company-r2',
  factory: function () {
    var plugin = { apply: function () { installPanel() } }
    return { apply: plugin.apply, default: plugin }
  },
})
```

**注册契约**（你后续重构必须保持）：
- `id` 必须等于包的绝对路径（与 agent.cordis.yml 第 266 行挂载名一致）
- `factory(require)` 返回包导出，插件体放在 `apply`（同时提供 `default` 兜底）
- 参考实现：仓库 `packages/client/modules/src/client/manifest.ts` 第 147 行 `ClientPluginHandoff` 接口；`packages/extensions/cordis-client-runner/src/client/runtime.ts` 第 376 行 `sink.load({ id, factory })`

## 2. 你把目录 r1 改名为 r2 引发过"幽灵插件"事故

改名发生在 18:49，而 DSH 服务进程 16:45 就启动了 —— 旧进程内存里的插件清单仍指向 `company-r1`（磁盘上已不存在），导致每个新开的浏览器页面 boot 时 import 幽灵条目失败，**整个 Web UI 打不开**。

处置：服务已重启，清单重建后恢复正常。你自己在 yml 注释里写过"改名目录需重启 DSH 进程再开新会话"——这次事故把范围扩大了：**改名后旧进程不重启，Web UI 也会被拖死**。以后改名/删除本地包，提醒用户重启服务。

## 3. 服务托管方式已变更

- DSH Web 服务现由 macOS launchd 托管：`com.dsh.web`（配置：`~/Library/LaunchAgents/com.dsh.web.plist`）
- 日志落盘：`~/.dsh-web.log`（此前服务不写日志，排查只能靠会话文件）
- 用户桌面的 `DeepSeek Harness.app` 启动器仍然有效（服务已运行时只开浏览器）

## 4. 会话中断说明

19:47 左右服务被外部重启（清除幽灵 r1），你当时正在一个回合中。所有已写入磁盘的成果（packages/、roles/、文档）完好无损。**直接从被打断的任务继续即可，无需重做。**

## 5. 遗留观察项（非阻塞）

- 曾出现 `shell.overlay` 渲染崩溃：`undefined is not an object (evaluating 'card.children.push')`。当前 client.js 源码中已无此代码，疑似随你的迭代消失或由注册缺失间接引发。若面板再崩，按此线索排查。
- Chrome 151 下 Web UI 曾出现 33 插件 pending（疑似 WebSocket 被扩展拦截），Safari 正常。用户已知用 Safari 访问，与你的代码无关。

## 验证方式（修复后应全部成立）

1. 浏览器打开 `http://127.0.0.1:3080`：无 "Failed to load plugins" 横幅
2. 进入任意会话：左侧「对话 / 轨迹」选项卡正常
3. 你的面板：页面加载后由 `apply` 安装，`window.__COMPANY_PANEL_INSTALLED__ === true`
