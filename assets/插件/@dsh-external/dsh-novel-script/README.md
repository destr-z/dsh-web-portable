# @dsh-external/dsh-novel-script

小说转剧本 · **剧本批注工作台**。

以「集」为单位把小说原文和剧本左右对照，人在上面划词写批注，批注交给对话里的 AI 改稿，
产出下一版；旧版本原样冻住，成为历史。

> **设计以 `docs/执行设计-v2.md` 为准**（目录结构、工具参数、文件格式、错误显示、代码去留、
> 测试矩阵都在那儿）。本 README 只讲怎么构建和怎么装。
> 另有 `docs/交接文档.md`（需求与踩坑记录）与 `docs/回执-API事实与落地卡点.md`（DSH API 实测）。

---

## 分工（一句话）

**程序只读一个固定目录、照着清单显示、把批注存回去；版本怎么建、集怎么并、文件怎么改，全由 agent 用普通文件操作做。**

- 程序做 5 件事：扫 `剧本工作台/`、读原文/剧本/清单、按清单做原文高亮、把缺文件与清单问题说出来、保存批注。
- agent 做：建目录、拷原文（`Copy-Item`，字节复制）、逐集调 `novel_script_write_episode`、
  开新版（`Copy-Item -Recurse`）、合并拆分（`Move-Item` / `Remove-Item` / 重新编号）、写变更记录、勾批注状态。
- 程序**不判断剧情内容**：谁是角色、哪句是台词、对应得对不对，一概不管。

## 目录（工作区里，固定位置）

```
剧本工作台/
  小说原文.txt                    ← 用户原文的字节副本（固定名）
  v1/
    剧本/第1集剧本.txt            ← 工具生成（纯剧情正文）
    清单/第1集清单.txt            ← 工具生成（段落 → 原文行号）
    批注/第1集批注.txt            ← 程序写；agent 只改 done / resolvedIn
  v2/
    剧本/ 清单/ 批注/
    变更记录.txt                  ← agent 写
```

## 两个接口

**① 工具 `novel_script_write_episode`**（agent 用）

```jsonc
{
  "version": "v1",
  "episode": 1,
  "paragraphs": [
    { "text": "FADE IN:", "sourceRanges": null },
    { "text": "魁梧的江长海坐在公厕旁的长椅上，指间夹着烟。", "sourceRanges": [[2, 2]] }
  ]
}
```

一次生成**剧本**与**清单**两个文件：段落之间恰好一个空白行、末尾不写额外换行、
`scriptLines` 由工具算（agent 不填）。写入前先读原文总行数，
任何 `sourceRanges` 越界 → 报错，**两个文件都不写**。

**② 批注通道 `/api/novel-script/annotations`**（浏览器用）

宿主注册在 Connection 的 exact Fetch route 上（`/api` 载体自带 Host/Origin 校验与浏览器认证）。
`op: 'load' | 'save'`，写入时用 `sessionId` 解析出的会话工作区根 + 沙箱策略。
保存前先读盘：**文件不存在**才当空数组；存在但坏了 → **停止保存，不覆盖**；
按 `id` 合并，磁盘上的 `done` / `resolvedIn` 优先。

> 为什么不是 Typert Remote：那条路要生成式 zod 清单（40 KB 级、由生成器产出），
> 本插件的离线构建跑不了生成器。详见设计文档 §17。

## 构建

```powershell
cd <本插件目录>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1
```

完全离线：`tsc`（host）与 `tsdown`（client）都用 checkout 里现成的副本，不下载任何东西。
脚本会校验 client 产物的装载协议（`__ModuleLoader__`、react 是否被误打进 bundle 等）。

## 装进 DSH

profile（`~/.dsh/profiles/web/package.json`）里已经用 `link:` 指向本目录并登记在
`dsh.profile.bundles`；`node_modules\@dsh-external\dsh-novel-script` 是指过来的 junction。

**改了什么要做什么：**

| 改了什么 | 要做什么 |
|---|---|
| `src/client/**` | 跑一次构建 → **刷新浏览器** |
| `src/index.ts` / `src/shared/**`（宿主半边） | 跑一次构建 → **重启 `dsh web`** |

## 三条硬约束（都是实测踩出来的）

1. **宿主写文件必须带会话沙箱策略**：目标目录取调用方会话的 `header.cwd`，
   策略取 `sandboxPolicy.resolve({ session })`，并把它作为 `writeText` 的**第 5 个参数**。
   不带策略 → 退回部署默认策略（根是 DSH 服务进程目录）→ 写工作区一律被拒。
2. **浏览器侧读文件是分页的**：`workspaceFiles.read` 一次只给一页（默认 5000 行），
   超出只回 `eof: false`，不报错也不提示 —— 必须自动翻页读完（`src/client/workspace.ts` 已处理）。
3. **标题栏的拖动 handler 必须放过所有交互控件**：它末尾会 `preventDefault()`，
   而 `<select>` / `<input>` 的 mousedown 默认行为正是"打开下拉 / 聚焦"。
