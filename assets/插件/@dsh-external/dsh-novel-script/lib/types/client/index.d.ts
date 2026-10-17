/**
 * @dsh-external/dsh-novel-script —— 浏览器半边。
 *
 * 两个挂点，都刻意选成「加在旁边」而不是「替换」：
 *
 *  1. `sidebar.panellist`  —— 侧栏一个图标，点它开/关工作台。
 *  2. `shell.overlay`      —— 全屏浮层，工作台与对话浮窗都住在这里。
 *
 * ⚠️ 为什么不注册 `main` / `main.conversation`：
 *     官方对话区是 `main.conversation` 的**单占席位**（kind: 'single'），
 *     注册进去就是替换掉它。本插件要的是「浮在官方界面之上」，
 *     所以走 overlay —— 官方对话区一个像素都不动，轨迹页签、@引用、
 *     附件、命令面板这些全都在。
 *
 * ⚠️ `shell.overlay` 这一层是 click-through 的：注册进去的组件必须自己
 *     在根元素上写 `pointerEvents: 'auto'`，否则鼠标事件会穿过去。
 */
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots';
/** 浏览器 ctx 的最小面。 */
interface ClientContext {
    slots: SlotsService;
    effect(fn: () => void | (() => void), label?: string): void;
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
