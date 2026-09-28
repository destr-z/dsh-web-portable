/**
 * @dsh-external/dsh-ui-skin —— 宿主半边。
 *
 * 只做两件事，都不碰皮肤的实际渲染（渲染在浏览器半边）：
 *
 *   1. **声明设置** —— 导出 `Config`（schemastery），可写字段标 `.volatile()`。
 *      0.1.7 起设置由插件自己的 Config 声明、按 **profile 条目 id** 定位；客户端经
 *      `ctx.configForms` 读写，写入持久化到 profile 的 cordis patch。旧的命令式
 *      `settings.register(ns, schema, { applies: 'live' })` 在 0.1.7 已移除。
 *   2. **注册素材路由** —— 把"本地素材目录"里的图喂给浏览器（见 asset-serve.ts）。
 *      仓库里不带任何图片：个人素材不随插件分发，位图由使用者自己放进目录。
 *
 * 启动时打印生效的素材目录，让"图为什么没生效"一眼可查。
 *
 * @module @dsh-external/dsh-ui-skin
 */
import z from '@deepseek-ai/schemastery';
import { type SkinId } from './skin-settings.ts';
/** 本插件资产路由的挂载前缀。 */
export declare const ASSETS_ROUTE_PREFIX = "/dsh-ui-skin/assets";
export { ASSETS_DIR_FIELD, DEFAULT_SKIN, SKIN_ENTRY_ID, SKIN_FIELD, SKIN_IDS, isSkinId, type SkinId, type SkinSettings, } from './skin-settings.ts';
export { SKIN_ASSET_NAMES, assetFilePath, defaultAssetsDir, describeAssetsDir, isSkinAssetName, lookupAsset, openAsset, resolveAssetsDir, type SkinAssetName, } from './asset-serve.ts';
/** 本插件设置的值形状（Config 校验并填默认值后的有效值）。 */
type SkinConfig = {
    skin?: SkinId;
    assetsDir?: string;
};
/**
 * 设置命名空间声明（0.1.7 声明式模型）。
 *
 * `.volatile()` = 字段出现在设置面、可被客户端表单写入；写入持久化到 profile
 * 的 cordis patch，条目重载后 apply() 带新 config 再跑一次。旧的
 * `settings.register(ns, schema, { applies: 'live' })` 与 `settings.get(ns)`
 * 在 0.1.7 均已不存在。
 *
 * ⚠️ 必须是**真的** schemastery：设置描述面会调 `schema.toJSON()`、解析会调
 * `schema(value)`；手写"长得像 schema"的对象少了这些就抛错（表现为设置里
 * 写不进去）。
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    skin: z<"deepseek" | "codex" | "claude-code", "deepseek" | "codex" | "claude-code", "volatile-defined">;
    assetsDir: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    skin: z<"deepseek" | "codex" | "claude-code", "deepseek" | "codex" | "claude-code", "volatile-defined">;
    assetsDir: z<string, string, "volatile-defined">;
}>>, "plain">;
/** 只声明我们用到的宿主服务，避免把整个 dsh 类型面拖进编译。 */
interface HostContext {
    get: (name: string) => unknown;
    inject: (names: string[], callback: (ctx: HostContext) => void) => void;
    effect: (callback: () => (() => void) | void, label?: string) => void;
    /** 本插件的 fiber（settings.configure 的 owner 参数）。 */
    fiber: unknown;
    webServer?: WebServerLike;
}
interface WebServerLike {
    register: (route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: HttpRequestLike, res: HttpResponseLike) => void | Promise<void>;
    }) => () => void;
}
interface HttpRequestLike {
    url?: string;
}
interface HttpResponseLike {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string | Buffer) => void;
    once: (event: string, listener: () => void) => void;
    pipe?: (source: NodeJS.ReadableStream) => void;
}
export declare const name = "ui-skin";
/** settings 与 webServer 都是硬依赖：前者存目录，后者发图片。 */
export declare const inject: string[];
/**
 * 插件主体。
 * @param ctx - 宿主上下文。
 */
export declare function apply(ctx: HostContext, config: SkinConfig): void;
