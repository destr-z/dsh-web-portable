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
import { type ReactNode } from 'react';
export declare function Workbench(): ReactNode;
