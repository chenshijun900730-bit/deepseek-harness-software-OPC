# software-company-harness 安装指南

> 本指南以 macOS/Linux 为准（Windows 请自行适配路径与环境变量）。

software-company-harness 是 DeepSeek Harness（DSH）的一个「软件公司模式」preset：需求先冻结为可验收的产品规格与 Sprint 合同，编码与验收相互独立，失败自动走修复硬路由；面板实时展示流程进度、子代理调用与 Token 消耗。

## DSH 宿主安装

先安装 DSH 宿主。要求 Node.js 版本满足 `^22.19.0 || >=24.0.0`。

快速路径（直接以 npm 拉取并启动 Web 服务）：

```bash
npx @deepseek-ai/dsh web
```

源码路径（需要自行构建时，构建需 pnpm 11.7.0）：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm build
```

## preset 安装

把本仓库的 preset 复制到 DSH 用户目录：

```bash
cp -R presets/software-company ~/.dsh/.agent-presets/software-company
```

然后在 `~/.dsh/settings.yaml` 中新增或修改，使 `agent-presets.default: software-company` 生效：

```yaml
agent-presets:
  default: software-company
```

也可以不改文件：在 Web UI 的 Agent Presets 选择器里选「Software Company 公司模式」。

改完 preset 后重启 DSH（见下方「常见报错」第 4 条）。

## 模型配置

打开 Web UI：设置 → 模型 → 填入自己的 DeepSeek API Key。

角色库（`roles/roles.json`）硬编码了两档模型：`deepseek-v4-pro` 与 `deepseek-v4-flash`，依赖 DeepSeek 官方 provider，请确认所填 Key 可以访问这两个模型。

## 常见报错

1. Node 版本不满足：安装满足 `^22.19.0 || >=24.0.0` 的 Node.js 后重试。
2. preset 未发现：检查 `~/.dsh/.agent-presets/software-company/agent.cordis.yml` 是否存在、目录名 `software-company` 是否合法（`[a-z0-9][a-z0-9-]*`）、`agent-presets.default` 配置是否正确。
3. API Key 未配置：回到「模型配置」一节，填入 DeepSeek API Key。
4. 报 `Failed to load plugins` 或 `loaded without registering`：改 preset 后必须真正重启 DSH 进程。用 `ps` 核对进程启动时间与进程树，确认旧进程已被新进程替换；伪重启不生效（报错的 rev 变化只说明文件内容变了，不代表进程已重启）。

## 迁移：company-panel 宿主面挂载

company-panel 以裸包名挂载到宿主 web profile。编辑 `~/.dsh/profiles/web/cordis.patch.yml`，把 company-panel 行的 `name` 由旧的绝对路径改为裸包名 `software-company-panel`（新增条目同理）：

```yaml
name: software-company-panel
```

再为宿主 web profile 的 node_modules 建符号链接：

```bash
ln -s ~/.dsh/.agent-presets/software-company/packages/company-panel ~/.dsh/profiles/web/node_modules/software-company-panel
```

改完补丁与符号链接后重启 DSH 进程。
