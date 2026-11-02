<div align="center">

# Loom

**自己部署、手机优先的编程 agent 工作台。**
Claude Code、Codex、Kiro 跑在你自己的服务器上，电脑和手机浏览器都能用，
你自己的设备一条命令就能接进来。

[![Version](https://img.shields.io/badge/version-0.4.0-black)](CHANGELOG.zh-CN.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![Elixir](https://img.shields.io/badge/Elixir-Phoenix-4B275F)](mix.exs)
[![React](https://img.shields.io/badge/React-Vite-149ECA)](frontend/)
[![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Kiro-D97757)](docs/backends.md)

[English](README.md) · **简体中文**

[官网](https://quanquan1996.github.io/loom) ·
[功能](#功能) ·
[和上游的区别](#和上游相比新增了什么) ·
[更新日志](CHANGELOG.zh-CN.md) ·
[快速开始](#快速开始) ·
[文档](#文档)

</div>

---

Loom 是一个单用户使用的编程 agent 网页端。agent 跑在你的服务器上，Loom 把它们同步到你的每一台设备：合上电脑、拿起手机，那一轮还在接着跑。Loom 自己不调用任何模型，干活的是 `claude`、`codex`、`kiro-cli` 这几个命令行工具，用的是你已有的登录（Anthropic、Bedrock、OpenAI、Kiro）。

本仓库 fork 自 [EthanLLL/loom](https://github.com/EthanLLL/loom)，从 `cf1facd`（2026-10-28）分出来后独立开发，至今多了 140 多个提交，不再跟进上游。

## 亮点

- **三个 agent，一个界面。** Claude Code、Codex、Kiro CLI（ACP 协议）按会话选。模型也按会话选，每一轮都标出是哪个模型答的。
- **为手机设计。** ChatGPT 风格的界面，尺寸照它的 iOS 版量的：Working 卡片可以左右滑，建议回复点一下就能答，点一下就能复制，草稿跟着你换设备。
- **重启不断。** 一轮跑到一半时升级或重启 Loom，Claude Code 和 Kiro 会继续干活，Loom 起来后接着收。
- **agent 能自己干活。** 一句话建定时任务；虚拟员工有预算和 KPI；夜里 Sleep 自动整理记忆；需要你拍板的事推到铃铛里。
- **你的设备就是工具。** macOS、Linux、WSL、原生 Windows 一行命令接入，Android 装一个 APK；在 Loom 里移除设备，它会自己卸载。
- **有条理，而不只是一串列表。** 项目共用工作区，会话可以置顶；还有无痕会话、在新会话里接着做（Continue），以及自动改标题、归档。

## 和上游相比新增了什么

| 方面 | 上游 Loom | 本仓库 |
| --- | --- | --- |
| agent 后端 | Claude Code、Codex | **加了 Kiro CLI**（ACP），自动带上 Claude Code 的 MCP 和 skills |
| 选模型 | 按后端 | **按会话**，在顶栏切换；每一轮标出答题的模型；主模型过载时换备用模型 |
| 重启 | 会话从磁盘恢复 | **跑到一半的回合不会断**，重启或崩溃后自动接回来 |
| 界面 | 深色主题 | ChatGPT 风格，手机主题照 ChatGPT iOS 量的；玻璃质感的顶栏和输入框；浅色和深色；字号按区域调 |
| 会话列表 | 一个列表 | Recents、**置顶**、**Working**（最近一小时，可滑动的卡片，带进展摘要），侧边栏可以拖宽 |
| 项目 | — | 会话围绕**共用的工作区和说明**分组；项目页带 Files 和 Sessions 两个标签 |
| 会话类型 | 普通 | **无痕会话**（在沙箱里跑，30 天后自动删除）；**Continue**（fork 或读旧会话后续写）；被安全分类器拦下的会话会被放到一边 |
| 输入框 | 文字 + 附件 | **建议回复**（能一次问多个问题）；草稿跨设备同步；发送失败的消息保留并可重发；附件一次性上传 |
| 复制 | 手动选中文字 | 点一下行内代码就复制；每条消息下面有复制按钮 |
| 定时 | `/cron` | **Tasks 页面**、HTTP API、按实际钟点、用一句话描述任务 |
| 自主工作 | — | **虚拟员工**（预算、KPI、限定在一台设备上的工位、共用的老板画像）；**Sleep / Dream** 整理记忆 |
| 通知 | 一轮结束时推送 | **铃铛**：agent 推送的通知按 0–10 排优先级，带背景和可选回答，可以稍后再看；旁边是你的待办 |
| 整理 | — | `loom-tidy` / `loom-retitle`：定时改标题、归档、合并会话 |
| 设备（`loom-node`） | macOS、Linux、WSL | **加了原生 Windows 和 Android**（一个 APK，能控制屏幕）；设备图标；移除即自动卸载；安装码防暴力尝试 |
| 浏览器 | 桌面尺寸窗口 | 加了**手机尺寸**的窗口和画面流 |
| 部署 | `rel/deploy.sh` | **`rel/ship.sh`**：只发布已提交的代码，不会比线上版本旧；先列出要上线的提交，加 `--yes` 才发布 |

每个版本加了什么，见[更新日志](CHANGELOG.zh-CN.md)。

## 功能

### agent 会话

- **Claude Code、Codex、Kiro** 按会话选。Claude Code 每个会话常驻一个预热好的 `claude -p`，回复大约 2 秒就开始出，不用等 10 秒。Kiro 走 Agent Client Protocol，能用 Claude Code 配好的 MCP 和 skills。
- **模型和思考深度按会话设**，在顶栏切换，每一轮标出是哪个模型答的。常用模型过载时，由 `LOOM_CLAUDE_FALLBACK_MODEL` 设的模型接手。
- **每台设备看到的是同一个会话。** 在电脑上开一轮，在手机上看它跑完。重连的页面只补发漏掉的部分，手机锁屏回来会自动重连。
- **它干活时也能插话。** 一轮跑到一半发的消息，会并进正在跑的这一轮。
- **重启不断。** Loom 停着的时候（哪怕是崩溃），Claude Code 和 Kiro 的回合继续跑，Loom 起来后从原处接上。只有 Codex 的回合会等跑完再重启。
- **斜杠命令**：`/compact`、`/reload`、`/cron`，输入框里有菜单。

### 在手机上聊天

- **建议回复。** agent 在回复最后列出它预料到的几种回答，显示成按钮，点一下填进输入框。一次问多个问题时，每个问题一页，选完以编号行的形式填回来。
- **不丢东西。** 每个会话的草稿同时存在本机和服务器，换设备也在。没发出去的消息带红色 !，点一下重发。附件点发送时一次性上传，要么整条消息发出去，要么都不发。
- **一键复制**：点行内代码，或点任意消息下面的复制按钮。
- 外观：ChatGPT 风格，玻璃质感的顶栏和输入框，浅色和深色，字号按区域调，有未读标记；iOS 主屏应用会避开 iOS 顶部的模糊区。

### 组织会话

- **项目**：共用工作区和说明的一组会话。项目页有 Files 和 Sessions 两个标签。会话可以移进移出，移进来的会话下一条消息前会被告知它属于哪个项目。
- **置顶、Working、Recents。** 最近一小时用过的会话放在 Working，直到标记为 Done。手机上是可以左右滑的卡片，每张有进展摘要和最后一条回复的开头。
- **无痕会话**：在沙箱里跑（`bwrap`：什么都能读，只能写自己的工作区）；不进 Recents、记忆和项目；最后一条消息 30 天后自动删除，除非你保留或置顶了。
- **Continue**：会话太长时在新会话里接着做，可以 fork，也可以让新会话读一遍旧的。
- **整理**：`loom-tidy` 和 `loom-retitle` 两个 skill 一次性完成改标题、归档、合并，也可以设成每天自动跑。归档的会话在设置里。
- **Handoff**：agent 发现某件事该单独开一个会话处理时，经你同意，带着交接说明在 Recents 里新开一个。

### 自己干活的 agent

- **定时任务。** 比如"每个工作日 10:00 看一下……"：按实际钟点定时发提示。你说一句，agent 帮你建；Tasks 页面里能看到全部；也有 HTTP API（`Loom.Cron`）。
- **虚拟员工。** 有岗位、KPI 和每日预算的 agent，在分给它的项目上持续工作，可以跑在 Claude Code、Kiro 或 Codex 上。工位功能可以把它限定在一台设备上，由 hook 强制。可以填表招聘，也可以在对话里说清楚需求让 AI 建好。还可以给员工加硬权限（只能用指定的工具和命令，由 Claude Code 自己拦截），适合读邮件这类内容不可信的工作。所有员工共用一份老板画像，从你说过的话里学，你可以自己改。
- **Sleep / Dream。** 夜里有一个隐藏会话逐个回顾每个项目的会话，整理 Claude Code 的记忆，写一份报告。记忆目录以外的改动只提建议、不动手。记忆目录本身是一个 git 仓库，哪一晚整理得不好可以撤销。
- **铃铛。** agent 发通知，带 0–10 的优先级、背景和可选的回答；点开直接跳到相关那一轮，"稍后"可以先放一放。你的待办在旁边。
- **安全分类器拦截**也有处理：被拦的会话会被放到一边，可以在新会话里接着做。

### 终端

- 聊天旁边可以开真正的 PTY shell，同时开多个。关掉页面也不会断，两台设备可以共用一个 shell。OSC 52 剪贴板写入（tmux、nvim）能传到浏览器的剪贴板。

### Canvas 和幻灯片

- agent 写到会话 `output/` 目录里的东西，都会显示在聊天旁边的面板里：网页、图表、仪表盘、图库。图片、音频、视频、Markdown、CSV、文本都能直接看，还有一个列出会话全部文件的文件树。
- 页面跑在一个不透明来源的沙箱里，拿不到 Loom 的 token 和 API。
- 想要幻灯片，agent 会写一个 reveal.js 页面，支持代码高亮、KaTeX 公式，离线也能打开，还有导出 PDF 的按钮。

### 你自己的设备（`loom-node`）

在 Mac、Linux、WSL、Windows 电脑或 Android 手机上装好 `loom-node`，任何会话里的 agent 都能以你的身份在那台机器上干活。

- **跑命令**：在你的登录 shell 里跑（Windows 上是 PowerShell），输出实时传回，退出码也是真实的。**读写文件**：二进制也没问题。
- **Android**：装一个 APK；开启无障碍权限后，agent 能看屏幕，也能点击、滑动、输入（`loom-node control`）。
- **一行命令安装**：在设备对话框里拿到 `curl … | sh`（Windows 上是 `irm … | iex`）。装成当前用户的服务，休眠和重启后自动重连，不需要管理员权限。
- **只往外连**：由设备主动连 Loom，所以在 NAT 后面也能用。
- **默认就安全**：每台设备有自己的 token，服务器上只存哈希值。安装码 24 小时有效，2 分钟内输错 20 次，所有安装码都会作废。在 Loom 里移除设备，`loom-node` 会自己卸载，并删掉临时目录和日志。设备上跑过的所有命令都会在那台设备上记日志。

### 浏览器

可选：一个常驻在主机上的 Chromium，跑在虚拟显示器上（`rel/browser/`），窗口可以是桌面尺寸，也可以是手机尺寸。agent 通过 CDP 操作它。需要你登录一次网站或者过验证码时，从侧边栏的 **Browser** 接管（noVNC，在 Loom 的登录后面）。

### 自带的 skill

| Skill | 用途 |
| --- | --- |
| `browser` | 使用共享的、已登录的 Chromium |
| `slides` | 在 canvas 里做 reveal.js 幻灯片 |
| `loom-guide` | 根据 Loom 自己的文档回答关于 Loom 的问题 |
| `loom-notify` | 往铃铛和待办里发东西 |
| `loom-sessions` | 找到并读之前的某个会话 |
| `loom-handoff` | 把一件事转给一个新会话 |
| `loom-tidy`、`loom-retitle` | 改标题、归档、合并会话 |

### 应用

- 能装成 PWA。一轮结束时会推送**通知**，锁屏上也能收到，不需要你自己的账号或推送密钥。
- 桌面上有 **Vim 风格快捷键**：`i` 输入，`j`/`k` 滚动，空格是前导键，`?` 看全部快捷键（[docs/keys.md](docs/keys.md)）。

## 快速开始

需要：

- Elixir / Erlang（版本见 `mix.exs`）、Node.js + pnpm、Go（编译 `loom-node` 用）
- 至少一个已登录、在 `PATH` 里的 agent 命令行工具：`claude`、`codex` 或 `kiro-cli`

```sh
git clone https://github.com/quanquan1996/loom && cd loom
mix setup && (cd frontend && pnpm install)

mix phx.server             # 后端，端口 4000
cd frontend && pnpm dev    # 前端，端口 5173，/api 和 /socket 代理到后端
```

打开 <http://localhost:5173>，密码是 `LOOM_PASSWORD`（开发环境默认是 `loom`）。

部署到服务器见 [docs/deploy.md](docs/deploy.md)：一台机器，Loom 只监听本机，前面套 Cloudflare Tunnel，用 systemd 管理。之后用这几条命令发布：

```sh
rel/ship.sh                    # 列出比线上新的提交
rel/ship.sh --yes              # 构建并重启；正在跑的回合不受影响
rel/ship.sh --frontend --yes   # 只热替换前端，不重启
```

## 开发

| 命令 | 说明 |
| --- | --- |
| `mix test` | 后端测试 |
| `mix precommit` | 编译（警告即报错）、格式化、测试 |
| `cd frontend && pnpm build` | 类型检查并构建 |
| `cd frontend && pnpm md:check` | Markdown 渲染用例 |
| `cd frontend && pnpm transcript …` | 录制 / 回放一段真实的 agent 输出流（[详情](docs/architecture.md#81-debugging-record-and-replay)） |

## 文档

以下文档为英文（更新日志另有中文版）：

- [docs/architecture.md](docs/architecture.md)：Loom 怎么搭的（会话、项目、Sleep、员工、铃铛、无痕会话、设备）
- [docs/backends.md](docs/backends.md)：Claude Code、Codex、Kiro 的协议，按实测记录
- [docs/deploy.md](docs/deploy.md)：单机部署
- [docs/keys.md](docs/keys.md)：快捷键
- [CHANGELOG.md](CHANGELOG.zh-CN.md)：各版本及新增内容

## 致谢

本项目基于 [EthanLLL/loom](https://github.com/EthanLLL/loom)，从它 fork 而来。

## 许可证

[MIT](LICENSE)
