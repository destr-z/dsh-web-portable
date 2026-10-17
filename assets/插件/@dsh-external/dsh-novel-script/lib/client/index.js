import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useState } from 'react';
import { PANEL_ID, PANELLIST_SLOT, OVERLAY_SLOT } from '../shared/protocol.ts';
import { Workbench } from './Workbench.tsx';
import { overlayCss } from './styles.ts';
export const inject = ['slots'];
export function apply(ctx) {
    console.info('[novel-script] client apply: start');
    // 样式：一次插入，随插件卸载自动移除（styles.insert 的契约）。
    ctx.effect(() => {
        const tag = document.createElement('style');
        tag.setAttribute('data-novel-script', 'workbench');
        tag.textContent = overlayCss;
        document.head.append(tag);
        return () => { tag.remove(); };
    }, 'novel-script: styles');
    // ── 1. 侧栏图标：开/关工作台 ─────────────────────────────────────────────
    ctx.slots.inject(PANELLIST_SLOT, () => ctx.slots.register({
        name: PANELLIST_SLOT,
        id: PANEL_ID,
        order: 50,
        label: '小说转剧本',
    }, PanelIcon));
    // ── 2. 全屏浮层：工作台 + 对话浮窗 ───────────────────────────────────────
    ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT,
        id: PANEL_ID,
        order: 50,
        label: '小说转剧本',
    }, NovelScriptOverlay));
    console.info('[novel-script] client apply: slots registered');
}
/** 一个极简的共享开关：图标与浮层都要读它。 */
let open = true;
const listeners = new Set();
function setOpen(next) {
    open = next;
    for (const l of listeners)
        l();
}
function useOpen() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return open;
}
/** 侧栏图标：点一下开/关工作台。带一个待核对条数的徽标。 */
function PanelIcon({ size = 20, active }) {
    const isOpen = useOpen();
    return (_jsx("button", { type: "button", title: "\u5C0F\u8BF4\u8F6C\u5267\u672C", "aria-pressed": isOpen, onClick: () => setOpen(!isOpen), style: {
            width: size + 12,
            height: size + 12,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            borderRadius: 9,
            background: isOpen || active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            color: isOpen
                ? 'var(--dsw-alias-state-business-primary)'
                : 'var(--dsw-alias-label-tertiary)',
            cursor: 'pointer',
            position: 'relative',
        }, children: _jsxs("svg", { width: size * 0.8, height: size * 0.8, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, children: [_jsx("path", { d: "M4.5 1.5h5L13 5v9.5H4.5z", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round" }), _jsx("path", { d: "M9.3 1.6V5h3.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round" }), _jsx("path", { d: "M6.3 8.4h4M6.3 11h2.6", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })] }) }));
}
/**
 * 全屏浮层。
 *
 * 注意根元素的 `pointerEvents: 'auto'`——overlay 这一层默认 click-through，
 * 不写它的话整个工作台都点不动。
 */
function NovelScriptOverlay() {
    const isOpen = useOpen();
    if (!isOpen)
        return null;
    return (_jsx("div", { className: "ns-root", style: { pointerEvents: 'auto' }, children: _jsx(Workbench, {}) }));
}
//# sourceMappingURL=index.js.map