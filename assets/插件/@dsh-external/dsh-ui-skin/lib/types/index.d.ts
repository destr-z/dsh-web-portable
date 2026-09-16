/**
 * @dsh-external/dsh-ui-skin —— 宿主半边。
 *
 * 三件事，都不碰皮肤的实际渲染（那在浏览器半边）：
 *
 *   1. **注册 settings 命名空间 `dsh-ui-skin`** —— 浏览器半边用
 *      `ctx.settingsScope.bind({ namespace: 'dsh-ui-skin' })` 读写的只是这个服务的一面
 *      镜子；宿主不注册，客户端就无处可写，表现是"填了目录没反应"。
 *      （命名空间刻意**不叫** `ui-skin`：那是树内皮肤的命名空间，同一个命名空间被
 *      两个宿主插件注册会冲突。）
 *   2. **注册资产路由** —— 把"本地素材目录"里的图喂给浏览器（见 asset-serve.ts）。
 *      仓库里不带任何图片，这是"个人素材不再分发"的落点。
 *   3. **启动日志** —— 打印生效的素材目录与实际命中的图，让"图为什么没生效"
 *      一眼可查（否则只能靠猜）。
 *
 * 刻意**不 import 任何 @deepseek-ai 深路径**（只 import 类型）：外部插件的加载期
 * 依赖越少越好，schema 用 schemastery 兼容的最小实现就地写 —— 与
 * @dsh-external/dsh-self-plugins 同一套做法。
 *
 * @module @dsh-external/dsh-ui-skin
 */
/**
 * Settings 命名空间，必须与浏览器半边一致。
 *
 * 真相源在 asset-serve.ts（那边决定"从哪个目录读素材"，命名空间是它的一部分）；
 * 这里只是转出去给调用方。**不要在这里再写一份字面量** —— 之前就因为这个，
 * 留下了两份同名字面量、其中一份是过期值。
 */
export { SKIN_SETTINGS_NAMESPACE } from './asset-serve.ts';
/** 设置里承载"素材目录"的字段名。 */
export declare const ASSETS_DIR_FIELD = "assetsDir";
/** 本插件资产路由的挂载前缀。 */
export declare const ASSETS_ROUTE_PREFIX = "/dsh-ui-skin/assets";
export { SKIN_ASSET_NAMES, assetFilePath, defaultAssetsDir, describeAssetsDir, isSkinAssetName, lookupAsset, openAsset, resolveAssetsDir, type SkinAssetName, type UiSkinSettings, } from './asset-serve.ts';
/** 只声明我们用到的宿主服务，避免把整个 dsh 类型面拖进编译。 */
interface HostContext {
    get: (name: string) => unknown;
    inject: (names: string[], callback: (ctx: HostContext) => void) => void;
    effect: (callback: () => (() => void) | void, label?: string) => void;
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
export declare function apply(ctx: HostContext): void;
