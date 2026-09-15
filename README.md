# DSH Web 便携版（Windows）

> **非官方（unofficial）。** 这是个人打包的 DSH（DeepSeek Harness）Web 界面 Windows
> 便携启动器，**不是 DeepSeek 官方发行版**。主程序来自官方开源仓库
> [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），
> 本仓库只提供启动器、随包说明和打包脚本。

给不想装 Node、不想敲命令的人用：解压 → 双击 → 浏览器里用。

- 默认端口 **3099**，数据（对话记录、设置、密钥）存在 `%LOCALAPPDATA%\DSH-Web`，
  和程序文件夹分开，所以升级只要替换程序文件夹，记录不会丢。
- 界面上能正常用 `dsh` 的全部能力，另附 4 个自带插件（见下）。

## 这个仓库里有什么 / 没什么

| | |
|---|---|
| **有** | 启动器与诊断脚本、使用说明、版本更新记录、4 个自带插件、打包与校验脚本、许可证与第三方声明 |
| **没有** | `deepseek-harness.exe`（232 MB）、`deepseek-harness-rg.exe`、以及整包 zip |

超过 100 MB 的单个文件 GitHub 直接拒收，而且每次重新打包 exe 的哈希都会变，
塞进 Git 历史会迅速把仓库撑爆。所以：

- **程序本体和整包 zip 在 [Releases](../../releases) 里下载**，不进仓库；
- 仓库里的东西加起来只有几百 KB，是"能被 git 跟踪、能被 review"的那部分。

## 怎么用

1. 到 [Releases](../../releases) 下载 `DSH-Web-*.zip`，**完整**解压到任意位置
   （不要只复制其中几个文件）。
2. 双击 `启动 DSH Web.cmd`。会出现一个黑色窗口，别关它；几秒后浏览器自动打开。
3. 第一次要先填 API Key：界面左下角「设置」→ 模型/凭据 → 填你的 DeepSeek API Key。

Windows 第一次运行会弹「已保护你的电脑」，因为 exe 没有数字签名：
点「更多信息」→「仍要运行」。

升级：关掉窗口 → 用新版本文件夹替换旧的 → 重新双击。记录和设置自动保留。

详细说明（端口、日志位置、常见问题、插件怎么加/怎么卸）见包内 `使用说明.txt`。

## 自带的 4 个插件

| 插件 | 是什么 | 许可 |
|---|---|---|
| `@dsh-external/dsh-novel-script` | 剧本批注：小说改剧本时逐集对照原文与剧本，划词写批注 | MIT |
| `@dsh-external/dsh-prompt-compare` | 提示词对照：剧本定稿后逐集对照剧本与视频提示词，划词写批注 | MIT |
| `@dsh-external/dsh-persona-switcher` | 人设切换：按会话记住人设模板，输入框上方一键切换 | BSD-3-Clause |
| `dsh-whale-widget` | 小鲸鱼余额挂件：显示 DeepSeek 余额、今日已用、每轮消耗 | MIT |

**第三方作品声明**（这些不是我写的，按各自许可随包分发）：

- `dsh-whale-widget` —— 作者 **MeteorNOX**，来自
  [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT）。
- `dsh-persona-switcher` —— 来自
  [destr-z/dsh-persona-switcher](https://github.com/destr-z/dsh-persona-switcher)（BSD-3-Clause）。

想卸载某个插件：把程序目录 `插件\` 里对应的子文件夹删掉，重启即可。
想加插件：把打包好的插件文件夹（带 `lib\`）整个复制进 `插件\`，重启即可 ——
便携版**不会联网装依赖**，所以要"打包好的"形态。

## 自己重新打包

重新打包**需要一份 DSH 源码仓库**，单文件 exe 只能从源码构建：

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness
cd deepseek-harness && pnpm install

# 回到本仓库
pwsh -File build-portable.ps1 -Repo ..\deepseek-harness
```

- `-Repo` 也可以用环境变量 `DSH_HARNESS_REPO` 指定；不传就取上一级目录的
  `..\deepseek-harness`。**仓库里没有任何写死的本机路径**。
- **只改启动器 / 说明 / 插件这类随包文件时用 `-ReuseExe`**，复用
  `<Repo>\dist-exe` 里已有的 exe。原因：SEA 打包不是逐字节可复现的
  （exe 里嵌了构建时间戳），每次重新构建都会得到不同哈希，而版本记录里写死了
  exe 的 SHA256 —— 不用 `-ReuseExe` 就会让"记录 vs 实际"永远对不上。

产物在 `<上一级>\portable\`：`DSH-Web\`（目录）和 `DSH-Web.zip`（分发用）。

### 校验与指纹

```powershell
node scripts/selfcheck.mjs                   # 仓库自检（不需要 exe）
pwsh -File scripts/selfcheck.ps1             # 加语法检查
pwsh -File scripts/test-plugin-sync.ps1      # 插件同步逻辑的离线测试（不需要 exe）
node scripts/verify-pack.mjs                 # 校验装配产物与 zip
node scripts/update-record-hashes.mjs        # 回填 版本更新记录.txt 里的 SHA256 占位符
node scripts/verify-pack.mjs --archive       # 校验通过后归档到 版本记录\
```

`test-plugin-sync.ps1` 值得单独说一句：插件的"装进 profile / 摘掉不在包里的"
是一段**会删东西**的逻辑，改坏了不会报错、只会悄悄删错文件，或者在用户机上把
界面弄得起不来。这个测试在临时沙箱里用一个假 exe 把启动器当黑盒跑 5 个场景，
专门盯住"用户自己 `dsh plugin add` 装的包一个字节都不许动"这条底线。

`版本更新记录.txt` 里的指纹写成占位符 `__SHA256:start-dsh-web.ps1__`，
由 `update-record-hashes.mjs` 自动回填 —— 手抄 34 个哈希必然出错。
回填会改动记录文件本身，所以要**回填 → 重新打包 → 再跑一次 verify-pack.mjs**。

## 目录结构

```
assets/                     随包文件的唯一真相源（build 从这里拷进包）
  start-dsh-web.ps1         启动器主体（UTF-8 with BOM，改动后必须保住 BOM）
  启动 DSH Web.cmd          双击入口（纯 ASCII，CRLF）
  诊断.ps1                  只读诊断：程序文件/端口/数据目录/插件
  使用说明.txt              给最终用户的说明书
  版本更新记录.txt           每版一节的变更与指纹记录
  插件/                     打包好的自带插件（构建产物，含 lib/）
build-portable.ps1          构建 exe → 装配目录 → 压 zip
scripts/selfcheck.mjs       仓库自检（Node 侧）
scripts/selfcheck.ps1       仓库自检（PowerShell 语法侧）
scripts/test-plugin-sync.ps1 插件同步逻辑的离线测试（沙箱 + 假 exe）
scripts/verify-pack.mjs     产物与 zip 校验
scripts/vfs-gap-check.mjs   扫运行时树缺包
scripts/update-record-hashes.mjs  回填版本记录里的 SHA256
notices/                    再分发主程序必需的许可证与第三方声明
```

`DSH-Web\`、`DSH-Web.zip`、`dsh便携版版本记录\` 都是构建产物，已被 `.gitignore` 排除。

## 已知问题与边界

- **只支持 Windows**，依赖 Windows 自带的 `tar`（Win10 1803+）和 PowerShell 5.1+。
- **插件不是沙箱**：插件跑在 DSH 进程里，只装你信得过的。
- **不会自动换端口**：默认 3099，被别的程序占用时直接报出占用者并退出，不盲扫端口。
- **不改任何密钥**：程序本身不含 API Key，需要你自己在界面里配置。
- 便携版每次启动会把 `插件\` 挂进 profile（同盘用 junction，跨盘退回复制），
  并把"自己装过哪些包"记在 `%LOCALAPPDATA%\DSH-Web\managed-plugins.json`。
  你自己用 `dsh plugin add` 装的插件不会被启动器删除。

## 许可

- 本仓库的启动器、脚本与文档：**MIT**，见 [LICENSE](LICENSE)。
- 主程序 `deepseek-harness.exe`：MIT，`Copyright (c) 2026 DeepSeek`，
  见 [notices/LICENSE-deepseek-harness.txt](notices/LICENSE-deepseek-harness.txt)。
- 主程序所含第三方组件：见 [notices/THIRD_PARTY_NOTICES.md](notices/THIRD_PARTY_NOTICES.md)。
- 自带插件各自的许可见上表；四者的 `package.json` 与包内 `LICENSE` 均为准。
- 命名与素材遵循官方
  [BRAND_GUIDELINES](https://github.com/deepseek-ai/deepseek-harness/blob/main/BRAND_GUIDELINES.md)：
  项目名只用 "DSH" 缩写，不暗示官方背书。
