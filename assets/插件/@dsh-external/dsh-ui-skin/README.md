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
| 选中的皮肤 | 本插件的设置 `skin`（0.1.7 起按 **profile 条目 id** 定位） | 跟随 profile、可导出、多端一致；另存一份 `localStorage` **镜像**只为首屏不闪 |
| 素材目录 | 同一个设置的 `assetsDir` | 宿主半边读它决定从哪个目录服务图片 |

两项都是本插件 `Config` 里标了 `.volatile()` 的字段：**宿主声明**，客户端经
`ctx.configForms.get(条目 id)` 读写，写入持久化到 **profile 的 cordis patch**。

素材目录必须在设置里、不能只存 localStorage，是因为**宿主半边读不到 localStorage**。
皮肤的跨标签页同步由设置镜像负责（宿主文档一变，所有客户端都会收到新值），
所以不再需要监听 `storage` 事件。

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
  index.ts            宿主半边：声明设置 Config + 素材路由
  asset-serve.ts      素材目录解析、白名单、路径穿越防护、HTTP 路由
  skin-settings.ts    皮肤 id 常量与形状（两侧共用）
  skins.ts            三种皮肤的 token 层
  client/
    index.ts          浏览器半边：皮肤服务（overrideTokens / body 属性 / 设置行）
    SkinRow.tsx       设置页那一行（三张卡 + 素材目录输入框）
    assets.ts         素材 URL 与清单
    store.ts          官方 dsh-client-store 的薄封装 + React 选择器钩子
    marks/            识别标记（矢量 + 位图回退）
```

### 三条设计纪律（都是踩出来的）

1. **客户端半边的每个 `require` 都必须落在装载器的基线模块表里。** 装载器给工厂的
   `require` 只认「基线模块表 → 已物化记录 → boot graph 行 → 已注册工厂」，其他一律抛错。
   0.1.7 的基线表（`packages/client/web/src/seed.ts`）是：`react`、`react/jsx-runtime`、
   `react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`dsh-client-store`、
   `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`。规矩：
   - 服务（slots / locale / theme / configForms）走 `inject` 由宿主注入，不经过 `require`；
   - 基线表里的**库**（本插件用了 `dsh-client-store`）走 `require`，并在 `dsh.client.external`
     里声明 —— 静态表名不产生图边，零装配风险；
   - 不在表里的东西**不要声明**：声明了却供不上，会让这个 entry 永远 pending，
     **整个 Web 入口起不来**（0.1.5 时代 `dsh-client-store` / `ui-primitives` 都不在表里，
     所以当时改成包内实现；0.1.7 它们都进表了，那条限制不再成立）。

2. **patch 条目 id 用 `external-ui-skin`，不是 `ui-skin`。**
   0.1.5 时代树内也有一个 `ui-skin`（`packages/client/ui-skin`）；两者同时存在时同 id 会让
   loader 报 `duplicate loader entry id`，**整个界面起不来**（实测踩过）。
   加 `external-` 前缀后两条可以共存，用户留哪个都行。
   （0.1.7 已移除树内 `ui-skin`，这个冲突源不存在了；前缀**保留不改**——条目 id 现在
   同时是设置的定位 id（`SKIN_ENTRY_ID`），改名会让已写入的设置失效。）

3. **设置定位 id = profile 条目 id。**
   0.1.7 起设置不再是独立命名空间：`ctx.configForms.get(条目id)` 才是读写入口，
   宿主侧则导出 `Config`（用 `.volatile()` 标记可写字段）。所以 `SKIN_ENTRY_ID`
   必须和 `cordis.patch.yml` 的行 id 一字不差，写错的表现是设置读不出来
   （`status: 'unavailable'`）、素材目录静默失效。

---

## 许可

MIT。`src/client/marks/CrabMark.tsx` 与 `CloudMark.tsx` 是为本插件绘制的矢量标记；
鲸鱼剪影路径取自 DeepSeek Harness 的 `ui-primitives`（MIT，`Copyright (c) 2026 DeepSeek`），
已就地内联为 `FISH_PATH`，仅用于内置回退。

位图素材**不随本插件分发**，由使用者自行放入素材目录。
