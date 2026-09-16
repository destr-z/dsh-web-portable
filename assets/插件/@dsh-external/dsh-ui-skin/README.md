# @dsh-external/dsh-ui-skin —— DSH 皮肤插件

给 DSH Web 界面加一层**可选皮肤**：在「浅色 / 深色 / 跟随系统」之上再叠一套配色，并把
品牌面（侧栏标记、设置页皮肤卡）一起换掉。三种内置皮肤：

| 皮肤 | 配色 | 识别标记 |
|---|---|---|
| **DeepSeek**（默认） | 官方蓝 `#4D6BFE` | 内置矢量鲸鱼（或你自备的 deepseek娘 图） |
| **Codex** | 单色近黑 + 绿 `#53B559` | 内置矢量云（或自备的 Codex 图标） |
| **Claude Code** | 奶油 `#FAF9F5` / 炭黑 `#262624` + 橙 `#D97757` | 内置矢量蟹（或自备的 Claude 图标） |

皮肤只是**表现层**：换皮肤不动明暗偏好，换明暗则皮肤层按新模式重新合成
（走 `ThemeRuntime.overrideTokens` 的 light/dark 双值契约）。

---

## 安装

```powershell
dsh plugin --profile web add github:destr-z/dsh-ui-skin
```

或者把本目录整体放进便携版的 `插件\` 文件夹，重启程序。

装好后到 **设置 ▸ 通用** 找「皮肤」，三张卡点一下就切。

---

## 图片素材（可选，默认不带图）

插件的识别标记默认是**内置矢量图**，开箱即用、仓库里一张图片都没有。

想要位图，把下面**三张**放进**素材目录**即可（三张卡一张一张对）：

| 卡片 | 文件名 |
|---|---|
| DeepSeek | `deepseek-mascot.png` |
| Codex | `codex-icon.png` |
| Claude Code | `claude-icon.png` |

**就这三张，一张不多。** 白名单只认这三个名字，其他文件名一律 404。

素材目录按优先级：

| 优先级 | 目录 |
|---|---|
| ① | 设置页「皮肤」里填的**素材目录**（绝对路径） |
| ② | 默认：`%LOCALAPPDATA%\DSH-Web\skins\`（Windows）／`~/.dsh/skins/`（其他） |

行为：

- 目录里**没有**某张图 → 那张卡用内置矢量版，**不发失败请求**（客户端先取一次
  `/dsh-ui-skin/assets/manifest.json` 问"有哪几张"，再决定请求什么）；
- 放进新图后刷新页面即可生效（清单是 `no-store` 的）；
- 改了素材目录 → 设置写入后立即重新拉清单，不用重启。

> 为什么默认不带图：这几张是**个人素材**（其中含第三方产品的品牌图标），
> 不适合随插件再分发。插件只提供"从本地目录读图"的能力。

---

## 设置

| 项 | 存哪 | 说明 |
|---|---|---|
| 选中的皮肤 | 浏览器 `localStorage`（`dsh.ui-skin.skin`） | 跨标签页实时同步 |
| 素材目录 | settings 命名空间 `ui-skin` 的 `assetsDir` | 宿主半边读它决定从哪个目录服务图片 |

素材目录放在 settings 而不是 localStorage，是因为**宿主半边读不到 localStorage**。

---

## 开发

```powershell
# 构建（host 走 tsc，client 走 tsdown；完全离线，借 checkout 里现成的工具）
pwsh -File scripts/build.ps1
pwsh -File scripts/build.ps1 -Checkout D:\path\to\deepseek-harness   # 指定源码仓库

# 冒烟测试：把 lib/client.js 当模块在 Node 里真执行一遍（抓"加载即抛错"）
node scripts/smoke-client.mjs

# 实测：用便携版 exe 在 3099 起一个隔离实例，验证路由 / boot graph
pwsh -File scripts/test-instance.ps1
```

### 结构

```
src/
  index.ts            宿主半边：注册 settings 命名空间 + 资产路由
  asset-serve.ts      素材目录解析、白名单、路径穿越防护、HTTP 路由
  skin-settings.ts    皮肤 id 常量与形状（两侧共用）
  skins.ts            三种皮肤的 token 层
  client/
    index.ts          浏览器半边：皮肤服务（overrideTokens / body 属性 / 设置行）
    SkinRow.tsx       设置页那一行（三张卡 + 素材目录输入框）
    assets.ts         素材 URL 与清单
    store.ts          40 行本地状态容器 + React 选择器钩子
    marks/            识别标记（矢量 + 位图回退）
```

### 两条设计纪律（都是踩出来的）

1. **客户端半边不 `require` 任何 `@deepseek-ai` 包。** 装载器给工厂的 `require`
   只认「基线模块表 → 已物化记录 → boot graph 行 → 已注册工厂」，基线表里就
   React / ReactDOM / cordis 这些。所以：
   - 服务（slots / locale / theme / settingsScope）走 `inject` 由宿主注入；
   - 类型 import 编译期抹掉；
   - 原本要用的 `dsh-client-store` / `ui-primitives` 换成包内实现
     （`client/store.ts`、自带的鲸鱼矢量图），免得为一条依赖去声明
     `dsh.client.external` 供给方。

2. **patch 条目 id 用 `external-ui-skin`，不是 `ui-skin`。**
   树内也有一个 `ui-skin`（`packages/client/ui-skin`）；两者同时存在时同 id 会让
   loader 报 `duplicate loader entry id`，**整个界面起不来**（实测踩过）。
   加 `external-` 前缀后两条可以共存，用户留哪个都行。

---

## 许可

MIT。`src/client/marks/CrabMark.tsx` 与 `CloudMark.tsx` 是为本插件绘制的矢量标记；
鲸鱼剪影路径取自 DeepSeek Harness 的 `ui-primitives`（MIT，`Copyright (c) 2026 DeepSeek`），
已就地内联为 `FISH_PATH`，仅用于内置回退。

位图素材**不随本插件分发**，由使用者自行放入素材目录。
