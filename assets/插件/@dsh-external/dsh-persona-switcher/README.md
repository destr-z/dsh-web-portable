# dsh-persona-switcher

[English](README.en.md)

DSH（DeepSeek Harness）人设切换器：**按会话记忆**的人设模板库。在设置页维护模板（名称 + 文字），在对话输入框左下角选择即生效——新对话没说话时就能选，选完下一条消息立即按新方式工作；未选择的对话完全不受插件影响。

## 界面

设置页的模板卡片：

![Settings card](docs/preview-settings.png)

新对话时在输入框选择器中选择：

![Composer selector](docs/preview-selector.png)

## 特性

- **按会话记忆**：每个对话独立选择，互不干扰；已选对话保存的是选择瞬间的模板快照
- **开始前选择**：输入框工具行的"人设"选择器，新对话未发第一句即可挑选
- **模板库**：设置 ▸ 插件配置 ▸ 人设，增删改模板；内置示例「猫娘」
- **秒生效**：保存即生效，无需重启、无需新建会话
- **官方 UI 风格**：卡片与下拉样式逐值复刻 DSH 自带控件（PluginCard / Menu）

## 安装

需要 DeepSeek Harness 的 Web 部署（`dsh-base` + `dsh-web-app` 层）：

```bash
dsh plugin --profile web add github:destr-z/dsh-persona-switcher
dsh --profile web          # 或按你惯常的方式重启 web
```

安装后自动通过 `dsh.bundle.patch` 装配 host 行，浏览器半（设置卡片 + 输入框选择器）由 `dsh.client` 声明自动加入。

> 构建产物（`lib/`）已提交，无需本地构建即可安装。

## 使用

1. **管理模板**：设置 ▸ 插件配置 ▸ 人设 —— 展开卡片，点选模板编辑名称/文字，＋ 新增，删除；
2. **选择**：任意对话输入框左下角点"人设"（默认透明、悬停浮现灰底胶囊）→ 菜单向上弹出 → 选模板或"未设置"；
3. 输入框控件本身显示当前 `人设：xxx`，无需其他标识。

## 边界与免责声明

- 本插件只提供"写入模型输入文字"的通道——自定义提示词（人设文字）是模型平台的基本能力，任何 LLM 客户端均可做到；本插件不新增、也不代表任何绕过模型安全限制的能力。模型的安全行为由其自身训练决定，插件无法也无意改变。
- 模板内容由使用者自备。请遵守所使用的模型服务商条款与当地法律；因模板内容产生的问题由部署者/使用者负责。
- 插件不触碰沙箱、审批等机制性安全控制，也无任何网络请求、密钥或凭据。

## 工作原理（简述）

- host 端：在 DSH settings 服务注册 `persona-switcher` 命名空间（模板库 + 会话快照）；监听会话生命周期，仅对**已选择**的会话在会话作用域注册 `deployment:persona` 段（遮蔽全局/预设 persona），未选择时不注入任何内容；
- client 端：设置页折叠卡片（模板管理）+ `conversation.input.left` 工具行选择器（自绘菜单，样式与官方 Menu 一致）。

## 开发

```bash
git clone <repo>
cd dsh-persona-switcher
npm install            # 需要 node + npm
DSH_CHECKOUT=<dsh源码检出目录> bash scripts/build.sh   # 编译 src → lib（host tsc + client tsdown）
```

配合 [dsh-super-injector](https://github.com/) 的开发环境可运行时注入/热重载。

## License

BSD-3-Clause
