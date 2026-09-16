/** 本插件资产路由的挂载前缀。 */
export declare const ASSETS_ROUTE_PREFIX = "/dsh-ui-skin/assets";
/**
 * 允许提供的资产文件名（白名单）。
 *
 * **就是设置页三张卡各用一张，一张都不多。** 早先这里照抄源码素材列表列了 6 个，
 * 其中 `deepseek-avatar.png` / `deepseek-mascot-head.png` / `deepseek-favicon.png`
 * 在插件里从来没有被真正渲染过（favicon 那一处已按"去掉反而更好"删除）。
 * 多余的条目只会让"该往目录里放哪几张图"变得含糊，所以砍到 3 张。
 */
export declare const SKIN_ASSET_NAMES: readonly ["deepseek-mascot.png", "codex-icon.png", "claude-icon.png"];
/** 一个合法的资产文件名。 */
export type SkinAssetName = typeof SKIN_ASSET_NAMES[number];
/**
 * 设置命名空间（宿主注册 + 客户端读写，两边必须一致）。
 *
 * 这是**唯一真相源**（本文件拥有"素材目录放哪、从哪读"这件事，命名空间是它的一部分）。
 * 刻意不叫 `ui-skin`：那是树内皮肤的命名空间，同一个命名空间被两个宿主插件注册会冲突。
 */
export declare const SKIN_SETTINGS_NAMESPACE = "dsh-ui-skin";
/** 设置里承载"资产目录"的字段名。 */
export declare const ASSETS_DIR_FIELD = "assetsDir";
/** 设置文档形状。两个字段都可选：未设置时各自走默认。 */
export interface UiSkinSettings {
    /** 皮肤资产目录（绝对路径）；空 = 用默认目录。 */
    assetsDir?: string;
}
/**
 * 判断一个请求路径里的文件名是否是受支持的资产。
 * @param name - 请求里的文件名（不含目录）。
 * @returns 是否是白名单成员。
 */
export declare function isSkinAssetName(name: string): name is SkinAssetName;
/**
 * 本机默认的皮肤资产目录。
 *
 * 便携版的启动器把 `%LOCALAPPDATA%\DSH-Web` 当作数据目录（并设成 DSH_HOME），
 * 所以插件把素材也放它下面，用户"数据都在一处"的心智不用改。开发机上没有
 * 那个目录时退回 `~/.dsh/skins`。
 * @returns 默认目录的绝对路径（不一定存在）。
 */
export declare function defaultAssetsDir(): string;
/**
 * 解析出当前生效的资产目录。
 * @param configured - 设置里填的 `assetsDir`（可为空/非字符串）。
 * @returns 绝对路径；配置非法（不是绝对路径）时退回默认目录。
 */
export declare function resolveAssetsDir(configured: unknown): string;
/**
 * 在指定目录里安全地解析一个资产文件路径。
 * @param dir - 资产目录（绝对路径）。
 * @param name - 经 {@link isSkinAssetName} 校验过的文件名。
 * @returns 文件绝对路径；越界时返回 undefined。
 */
export declare function assetFilePath(dir: string, name: SkinAssetName): string | undefined;
/** 路由处理结果：命中则给出文件与 MIME，未命中给出 404 原因。 */
export type AssetLookup = {
    ok: true;
    path: string;
    contentType: string;
} | {
    ok: false;
    status: number;
    reason: string;
};
/**
 * 查一个资产：先过白名单，再在目录里确认文件存在且是普通文件。
 * @param dir - 资产目录（绝对路径）。
 * @param rawName - 请求里的原始文件名。
 * @returns 命中信息或 404 原因。
 */
export declare function lookupAsset(dir: string, rawName: string): Promise<AssetLookup>;
/** 打开一个资产文件的读流（供路由把内容推给响应）。 */
export declare function openAsset(path: string): NodeJS.ReadableStream;
/**
 * 本机的资产目录说明，用于启动日志与诊断（让"图为什么没生效"一眼可查）。
 * @param configured - 设置里填的 `assetsDir`。
 * @returns 生效目录与它是不是默认值。
 */
export declare function describeAssetsDir(configured: unknown): {
    dir: string;
    isDefault: boolean;
};
