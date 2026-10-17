import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 工作台骨架（第一版：只验证挂点与浮层是否工作）。
 *
 * 后续按设计稿填充：
 *   · 三栏（原文 / 剧本 / 批注）+ 两根可拖的列宽把手
 *   · 划词批注、Ctrl 多选合成一条、点引文两边同时跳
 *   · 对话浮窗
 *
 * 这一版刻意保持极小，目的是**先让它真的出现在界面上**——
 * 挂点、pointer-events、样式注入这三件事没验证过之前，
 * 写再多组件都是空中楼阁。
 */
import { useState } from 'react';
export function Workbench() {
    const [pos, setPos] = useState(null);
    const [drag, setDrag] = useState(null);
    const [note, setNote] = useState('');
    /** 拖动：用 delta 位移，不动宽高（避免把上一帧的位置覆盖掉）。 */
    function onMove(e, next) {
        const nx = Math.max(0, next.ox + (e.clientX - next.sx));
        const ny = Math.max(0, next.oy + (e.clientY - next.sy));
        setPos({ x: nx, y: ny });
    }
    const style = pos
        ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
        : {};
    return (_jsxs("div", { className: "ns-workbench", style: style, onMouseMove: (e) => { if (drag)
            onMove(e, drag); }, onMouseUp: () => setDrag(null), onMouseLeave: () => setDrag(null), children: [_jsxs("div", { className: "ns-wb-hd", onMouseDown: (e) => {
                    if (e.target.closest('button'))
                        return;
                    const box = e.currentTarget.parentElement.getBoundingClientRect();
                    setDrag({ sx: e.clientX, sy: e.clientY, ox: box.left, oy: box.top });
                    e.preventDefault();
                }, children: [_jsx("span", { className: "ns-grip", "aria-hidden": true, children: "\u22EE\u22EE" }), _jsx("span", { className: "ns-t", children: "\u5C0F\u8BF4\u8F6C\u5267\u672C" }), _jsx("span", { className: "ns-meta", children: "\u5DE5\u4F5C\u53F0\u5DF2\u6302\u8F7D \u00B7 \u7B2C\u4E00\u7248\u9AA8\u67B6" }), _jsx("div", { className: "ns-spacer" }), _jsx("button", { type: "button", className: "ns-x", title: "\u5173\u6389", onClick: () => setNote(''), children: "\u2715" })] }), _jsxs("div", { className: "ns-wb-bd", children: [_jsxs("p", { className: "ns-p", children: ["\u8FD9\u4E00\u7248\u53EA\u9A8C\u8BC1\u4E09\u4EF6\u4E8B\uFF1A", _jsx("b", { children: "\u4FA7\u680F\u56FE\u6807\u80FD\u70B9\u5230" }), "\u3001", _jsx("b", { children: "\u6D6E\u5C42\u80FD\u6D6E\u5728\u5B98\u65B9\u754C\u9762\u4E4B\u4E0A" }), "\u3001", _jsx("b", { children: "\u6837\u5F0F\u6CE8\u5165\u751F\u6548" }), "\u3002"] }), _jsxs("p", { className: "ns-p", children: ["\u5B98\u65B9\u5BF9\u8BDD\u533A\u5728\u4E0B\u9762\u5B8C\u597D\u65E0\u635F \u2014\u2014 \u6D6E\u5C42\u662F ", _jsx("code", { children: "shell.overlay" }), "\uFF08frame-wide \u6D6E\u5C42\uFF09\uFF0C \u6CA1\u6709\u52A8 ", _jsx("code", { children: "main.conversation" }), " \u90A3\u4E2A\u5355\u5360\u5E2D\u4F4D\u3002"] }), _jsxs("div", { className: "ns-row", children: [_jsx("button", { type: "button", className: "ns-btn", onClick: () => setNote('拖动这个面板的标题栏试试'), children: "\u8BD5\u4E00\u4E0B" }), _jsx("span", { className: "ns-note", children: note })] })] })] }));
}
//# sourceMappingURL=Workbench.js.map