/**
 * 宿主与浏览器两侧共用的**契约**：固定目录、文件名规则、数据结构、路径拼法。
 *
 * 这个文件是唯一的真相源。设计依据见 `docs/执行设计-v2.md`。
 *
 * 三条硬约定（改之前先读文档 §1）：
 *   1. 工作台固定在 `<工作区根>/剧本工作台/`，不需要任何设置项；
 *   2. 版本号由目录名（`v1`）决定、集号由文件名（`第1集剧本.txt`）决定，
 *      **不在清单里重复保存**；
 *   3. 集号一律用阿拉伯数字 —— 程序不解析中文数字。
 */
/** 插件 id（与 package.json 的 name 一致）。 */
export const PLUGIN_ID = '@dsh-external/dsh-novel-script';
/* ── 浏览器侧挂点 ──────────────────────────────────────────────────────── */
/**
 * 全屏浮层席位。
 *
 * ⚠️ 不注册 `main` / `main.conversation` —— 那是官方对话区的单占席位，
 * 注册进去就是替换掉官方对话。这里只需要"浮在上面"。
 */
export const OVERLAY_SLOT = 'shell.overlay';
/** 插件在席位里的 id（须唯一）。 */
export const PANEL_ID = 'novel-script';
/* ── 剧本工作台：固定目录与固定文件名 ──────────────────────────────────── */
/** 工作台根目录（工作区里的固定名字）。 */
export const WORKBENCH_DIR = '剧本工作台';
/** 原文文件名（固定）。原文只有一份，行号以它的物理行为准。 */
export const NOVEL_FILE = '小说原文.txt';
export const SCRIPT_DIR = '剧本';
export const MANIFEST_DIR = '清单';
export const ANNOTATION_DIR = '批注';
export const CHANGELOG_FILE = '变更记录.txt';
/* ── 文件名规则（全部要求阿拉伯数字） ──────────────────────────────────── */
export const RE_VERSION_DIR = /^v(\d+)$/;
export const RE_SCRIPT_FILE = /^第(\d+)集剧本\.txt$/;
export const RE_MANIFEST_FILE = /^第(\d+)集清单\.txt$/;
export const RE_ANNOTATION_FILE = /^第(\d+)集批注\.txt$/;
/** 工具的 version 参数。 */
export const RE_VERSION_ARG = /^v\d+$/;
/** 清单格式版本。 */
export const MANIFEST_SCHEMA = 1;
/* ── 批注通道 ──────────────────────────────────────────────────────────── */
/**
 * 批注的浏览器 → 宿主通道。
 *
 * ⚠️ 为什么是 HTTP 路由而不是 Typert Remote：官方给"浏览器→宿主"这类
 * 非 JSON-Remote 数据的通道就是 Connection 的 exact Fetch route
 * （`/api` 载体自带 Host/Origin 校验与浏览器认证，见
 * `packages/client/connection/src/index.ts` 的 `/api` 路由）。
 * Typert 那条路要生成式 zod 清单（40 KB 级、由生成器产出，本插件的离线构建
 * 跑不了生成器），代价与收益不成比例。设计文档 §17 记了这条偏离。
 */
export const ANNOTATION_ROUTE = '/api/novel-script/annotations';
/* ── 路径拼法（一律相对**工作区根**、正斜杠）────────────────────────────
   ⚠️ 不要写成相对清单文件的 `../剧本/…`：程序读文件走的是会话锚定的
   工作区相对路径，多一层相对换算只会多一处出错。 */
export const workbenchPath = () => WORKBENCH_DIR;
export const novelPath = () => `${WORKBENCH_DIR}/${NOVEL_FILE}`;
/**
 * 把"版本"统一成**目录名**。
 *
 * ⚠️ 两种写法都收：`v1`（目录名）和 `1`（去掉 v 的版本号）。
 *    踩过一次：扫描结果里存的是去掉 v 的 `1`，直接拼路径就成了
 *    `剧本工作台/1/清单/…`，清单永远找不到、剧本栏整个空白。
 *    在拼路径这一层归一，比要求每个调用方都记得传哪种更稳。
 */
export function asVersionDir(version) {
    return RE_VERSION_DIR.test(version) ? version : `v${version.replace(/^v/i, '')}`;
}
export const versionPath = (version) => `${WORKBENCH_DIR}/${asVersionDir(version)}`;
export const scriptPath = (version, episode) => `${versionPath(version)}/${SCRIPT_DIR}/第${episode}集剧本.txt`;
export const manifestPath = (version, episode) => `${versionPath(version)}/${MANIFEST_DIR}/第${episode}集清单.txt`;
export const annotationPath = (version, episode) => `${versionPath(version)}/${ANNOTATION_DIR}/第${episode}集批注.txt`;
export const changelogPath = (version) => `${versionPath(version)}/${CHANGELOG_FILE}`;
/* ── 小工具 ────────────────────────────────────────────────────────────── */
/**
 * 版本号排序：`1 < 2 < 10`（按数字比，不是按字符串）。
 * 参数是**不带 v 的数字串**。
 */
export function compareVersions(a, b) {
    const na = Number.parseInt(a, 10);
    const nb = Number.parseInt(b, 10);
    if (Number.isFinite(na) && Number.isFinite(nb))
        return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
}
/** 目录名 → 版本号（不带 v）；不是版本目录就返回 undefined。 */
export function versionOfDir(name) {
    return RE_VERSION_DIR.exec(name)?.[1];
}
/**
 * 程序生成的批注编号。
 * @param seq - 从 1 开始的序号。
 */
export function annotationId(seq) {
    return `a-${String(seq).padStart(4, '0')}`;
}
//# sourceMappingURL=protocol.js.map