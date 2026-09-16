/**
 * 皮肤资产（图片）的目录解析与 HTTP 路由。
 *
 * ## 为什么需要这一层
 *
 * 皮肤的"识别标记"里有两类图：Codex 的云、Claude Code 的蟹，以及 deepseek娘
 * 的头像/全身。这些图**不随插件分发**（是个人素材，见 README），所以：
 *
 *   1. 插件仓库里一张图都不带 → 不会有再分发问题；
 *   2. 用户在**本地目录**里放图 → 路由读它并喂给浏览器；
 *   3. 目录里没有那张图 → 返回 404 → 浏览器端 RasterIcon/WhaleGirlMark
 *      回退到内置矢量标记 → 界面照常能用，只是标记变成矢量版。
 *
 * 目录解析优先级（先命中先用）：
 *   ① 设置里的 `assetsDir`（绝对路径，用户在设置页填）
 *   ② `%LOCALAPPDATA%\DSH-Web\skins\`（便携版默认；Windows）
 *      或 `~/.dsh/skins/`（开发机默认；非 Windows，或没有 LOCALAPPDATA）
 *
 * ## 安全边界
 *
 * 只按**白名单文件名**提供文件，不接受任意路径。请求里的名字必须先通过
 * {@link isSkinAssetName}，再在目录内解析、再做一次前缀校验 —— 这样
 * `..\..\..\Windows\win.ini` 这类穿越在两道闸门上都过不去。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
/** 本插件资产路由的挂载前缀。 */
export const ASSETS_ROUTE_PREFIX = '/dsh-ui-skin/assets';
/**
 * 允许提供的资产文件名（白名单）。
 *
 * **就是设置页三张卡各用一张，一张都不多。** 早先这里照抄源码素材列表列了 6 个，
 * 其中 `deepseek-avatar.png` / `deepseek-mascot-head.png` / `deepseek-favicon.png`
 * 在插件里从来没有被真正渲染过（favicon 那一处已按"去掉反而更好"删除）。
 * 多余的条目只会让"该往目录里放哪几张图"变得含糊，所以砍到 3 张。
 */
export const SKIN_ASSET_NAMES = [
    'deepseek-mascot.png',
    'codex-icon.png',
    'claude-icon.png',
];
/**
 * 设置命名空间（宿主注册 + 客户端读写，两边必须一致）。
 *
 * 这是**唯一真相源**（本文件拥有"素材目录放哪、从哪读"这件事，命名空间是它的一部分）。
 * 刻意不叫 `ui-skin`：那是树内皮肤的命名空间，同一个命名空间被两个宿主插件注册会冲突。
 */
export const SKIN_SETTINGS_NAMESPACE = 'dsh-ui-skin';
/** 设置里承载"资产目录"的字段名。 */
export const ASSETS_DIR_FIELD = 'assetsDir';
/**
 * 判断一个请求路径里的文件名是否是受支持的资产。
 * @param name - 请求里的文件名（不含目录）。
 * @returns 是否是白名单成员。
 */
export function isSkinAssetName(name) {
    return SKIN_ASSET_NAMES.includes(name);
}
/** 按基名猜 MIME；只覆盖白名单里可能出现的类型，其余一律按二进制流。 */
function contentTypeOf(name) {
    if (name.endsWith('.png'))
        return 'image/png';
    if (name.endsWith('.gif'))
        return 'image/gif';
    if (name.endsWith('.webp'))
        return 'image/webp';
    if (name.endsWith('.svg'))
        return 'image/svg+xml';
    return 'application/octet-stream';
}
/**
 * 本机默认的皮肤资产目录。
 *
 * 便携版的启动器把 `%LOCALAPPDATA%\DSH-Web` 当作数据目录（并设成 DSH_HOME），
 * 所以插件把素材也放它下面，用户"数据都在一处"的心智不用改。开发机上没有
 * 那个目录时退回 `~/.dsh/skins`。
 * @returns 默认目录的绝对路径（不一定存在）。
 */
export function defaultAssetsDir() {
    const localAppData = process.env.LOCALAPPDATA;
    if (process.platform === 'win32' && typeof localAppData === 'string' && localAppData !== '') {
        return join(localAppData, 'DSH-Web', 'skins');
    }
    const dshHome = process.env.DSH_HOME;
    if (typeof dshHome === 'string' && dshHome !== '')
        return join(dshHome, 'skins');
    return join(homedir(), '.dsh', 'skins');
}
/**
 * 解析出当前生效的资产目录。
 * @param configured - 设置里填的 `assetsDir`（可为空/非字符串）。
 * @returns 绝对路径；配置非法（不是绝对路径）时退回默认目录。
 */
export function resolveAssetsDir(configured) {
    if (typeof configured === 'string' && configured.trim() !== '') {
        const trimmed = configured.trim();
        // 只接受绝对路径：相对路径会随进程工作目录漂移 —— 便携版的工作目录是
        // 数据目录下的 workspace，用户填个 "skins" 会落到一个很意外的地方。
        if (resolve(trimmed) === trimmed || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
            return trimmed;
        }
    }
    return defaultAssetsDir();
}
/**
 * 在指定目录里安全地解析一个资产文件路径。
 * @param dir - 资产目录（绝对路径）。
 * @param name - 经 {@link isSkinAssetName} 校验过的文件名。
 * @returns 文件绝对路径；越界时返回 undefined。
 */
export function assetFilePath(dir, name) {
    const base = resolve(dir);
    const full = resolve(join(base, name));
    // 第二道闸门：解析后的路径必须仍在目录内（白名单已经排除了目录分隔符，
    // 这里是防"目录本身是符号链接"之类的边缘情况）。
    if (full !== base && !full.startsWith(base + sep))
        return undefined;
    return full;
}
/**
 * 查一个资产：先过白名单，再在目录里确认文件存在且是普通文件。
 * @param dir - 资产目录（绝对路径）。
 * @param rawName - 请求里的原始文件名。
 * @returns 命中信息或 404 原因。
 */
export async function lookupAsset(dir, rawName) {
    if (!isSkinAssetName(rawName)) {
        return { ok: false, status: 404, reason: `unknown skin asset: ${rawName}` };
    }
    const path = assetFilePath(dir, rawName);
    if (path === undefined) {
        return { ok: false, status: 400, reason: 'asset path escapes the configured directory' };
    }
    try {
        const info = await stat(path);
        if (!info.isFile())
            return { ok: false, status: 404, reason: 'not a regular file' };
    }
    catch {
        return { ok: false, status: 404, reason: `not found in ${dir}` };
    }
    return { ok: true, path, contentType: contentTypeOf(rawName) };
}
/** 打开一个资产文件的读流（供路由把内容推给响应）。 */
export function openAsset(path) {
    return createReadStream(path);
}
/**
 * 本机的资产目录说明，用于启动日志与诊断（让"图为什么没生效"一眼可查）。
 * @param configured - 设置里填的 `assetsDir`。
 * @returns 生效目录与它是不是默认值。
 */
export function describeAssetsDir(configured) {
    const dir = resolveAssetsDir(configured);
    return { dir, isDefault: dir === defaultAssetsDir() };
}
//# sourceMappingURL=asset-serve.js.map