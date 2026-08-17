# software-company-harness 安装指南

> 本指南以 macOS/Linux 为准（Windows 请自行适配路径与环境变量）。

software-company-harness 是 DeepSeek Harness（DSH）的一个「软件公司模式」preset：需求先冻结为可验收的产品规格与 Sprint 合同，编码与验收相互独立，失败自动走修复硬路由；面板实时展示流程进度、子代理调用与 Token 消耗。

## DSH 宿主安装

先安装 DSH 宿主。要求 Node.js 版本满足 `^22.19.0 || >=24.0.0`。

快速路径（直接以 npm 拉取并启动 Web 服务）：

```bash
npx @deepseek-ai/dsh web
```

> 提示：`npx` 对网络环境敏感，个别镜像/网络下会静默失败（退出码 1 且无任何输出）。遇到这种情况，改用下面的全局安装路径，一次安装长期可用，也免去每次重复下载。

全局安装路径（更稳，推荐）：

```bash
npm install -g @deepseek-ai/dsh
dsh web
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

### 端口说明

`dsh web` 默认监听 `127.0.0.1:3080`。同一台机器上若已有一个 DSH 实例在跑（例如开发/测试环境并存），再启动新实例会报 `EADDRINUSE` 直接退出。给新实例换个端口即可：

```bash
dsh web --port 14080        # npx 方式同理：npx @deepseek-ai/dsh web --port 14080
```

### 关于 npm allow-scripts 警告

安装时可能看到 `npm warn allow-scripts node-pty@...` 一类输出：新版 npm 默认拦截原生依赖的安装脚本。实测不影响 DSH 启动与 preset 加载；若后续遇到终端相关功能异常，按 npm 提示执行 `npm approve-scripts` 放行对应包即可。

## preset 安装（三步，全部必做）

### 第 1 步：复制 preset 到 DSH 用户目录

```bash
cp -R presets/software-company ~/.dsh/.agent-presets/software-company
```

### 第 2 步：配置默认 preset

在 `~/.dsh/settings.yaml` 中新增或修改，使 `agent-presets.default: software-company` 生效：

```yaml
agent-presets:
  default: software-company
```

也可以不改文件：在 Web UI 的 Agent Presets 选择器里选「Software Company 公司模式」。

### 第 3 步：挂载 company-panel（总监面板入口，必做）

不做这一步，preset 本体仍会加载（选择器里能看到「Software Company 公司模式」），但 Web UI 右上角**不会出现 🏢 Company 胶囊**，且没有任何报错提示——这是新用户最容易漏做的一步。

编辑 `~/.dsh/profiles/web/cordis.patch.yml`（文件不存在则创建，直接用下面的完整内容；已存在则确保含此条目）：

```yaml
- insert:
    - id: company-panel
      name: software-company-panel
```

再为宿主 web profile 建符号链接：

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
ln -s ~/.dsh/.agent-presets/software-company/packages/company-panel ~/.dsh/profiles/web/node_modules/software-company-panel
```

### 重启 DSH

改完 preset 与挂载后必须真正重启 DSH 进程（见「常见报错」第 5 条），然后打开 Web UI，确认右上角出现 🏢 Company 胶囊。

## 模型配置

打开 Web UI：设置 → 模型 → 填入自己的 DeepSeek API Key。

角色库（`roles/roles.json`）硬编码了两档模型：`deepseek-v4-pro` 与 `deepseek-v4-flash`，依赖 DeepSeek 官方 provider，请确认所填 Key 可以访问这两个模型。

## 常见报错

1. Node 版本不满足：安装满足 `^22.19.0 || >=24.0.0` 的 Node.js 后重试。
2. preset 未发现：检查 `~/.dsh/.agent-presets/software-company/agent.cordis.yml` 是否存在、目录名 `software-company` 是否合法（`[a-z0-9][a-z0-9-]*`）、`agent-presets.default` 配置是否正确。
3. API Key 未配置：回到「模型配置」一节，填入 DeepSeek API Key。
4. `npm warn allow-scripts`：见上文「关于 npm allow-scripts 警告」，一般可忽略。
5. 报 `Failed to load plugins` 或 `loaded without registering`：改 preset 后必须真正重启 DSH 进程。用 `ps` 核对进程启动时间与进程树，确认旧进程已被新进程替换；伪重启不生效（报错的 rev 变化只说明文件内容变了，不代表进程已重启）。
6. 报 `EADDRINUSE: address already in use 127.0.0.1:3080`：3080 被占用（多半是已有 DSH 实例在跑）。停掉旧实例，或给新实例加 `--port` 换端口（见「端口说明」）。
7. 右上角没有 🏢 Company 胶囊：company-panel 未挂载或挂载后未真正重启。回到「第 3 步」核对 `cordis.patch.yml` 条目与符号链接是否都在。

## 迁移：旧版绝对路径挂载升级

早期版本把 company-panel 以绝对路径挂载到宿主 web profile。升级到裸包名方式：编辑 `~/.dsh/profiles/web/cordis.patch.yml`，把 company-panel 条目的 `name` 由旧的绝对路径改为裸包名 `software-company-panel`，再按「第 3 步」建好符号链接，重启 DSH。
