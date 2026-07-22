# AGENTS.md — pi-turbo

## 项目定位

pi-turbo 是 `pi` 编码代理（`@earendil-works/pi-coding-agent`）的启动加速包装器，约 300 行代码。不是 fork——仅通过 monkey-patch `DefaultResourceLoader.prototype.loadFinalExtensionSet` 一个原型方法，将扩展加载从串行改为基于 EMA 时序画像的分块并行。

## 架构概览

```
bin/pi-tb.js           入口。用 --import src/patch.js 重新 exec node，然后调用上游 main()
src/patch.js           monkey-patch 挂载点。initPiEnv() 读状态，applyPatch() 替换原型方法
src/targeted-loader.js 核心算法。EMA 画像分区（I/O >500ms → 并行块）+ mergeInOrder() 按原序重组
src/timing.js          EMA 存储持久化。原子写入（temp + rename）
src/config.js          常量：PI_TURBO_DIR, EMA_ALPHA=0.3, MAX_HISTORY=100, 环境变量默认值
src/footer-patch.js    Footer 渲染缓存。patch getEntries() 和 getContextUsage()，消除 O(n) 重复扫描
test/smoke.mjs         冒烟测试（验证 pi 内部路径可达）
test/ab-compare.mjs    A/B 基准对比
```

## 核心不变量（违反任何一条 = 破坏性变更）

1. **注册顺序必须保持** — `mergeInOrder()` 按原始路径顺序遍历，扩展事件注册顺序不可乱
2. **patch 必须在 main() 之前生效** — `bin/pi-tb.js` 的 import 顺序是刻意设计，不可重排
3. **`this` 上下文必须透传** — patch 内调用原方法时 `this` 必须是 DefaultResourceLoader 实例
4. **上游错误不可吞没** — `loadExtensionsCached` 抛出的 per-extension 错误必须原样传播
5. **首次运行 = 纯串行画像** — 无 EMA 数据时所有扩展串行执行并记录时序，不可跳过
6. **Footer patch 必须 fail-safe** — 任何错误回退到原方法，不可影响 TUI 渲染

## 开发规则

- **禁止修改上游 pi 源码** — 本项目只通过原型 patch 介入，不 patch node_modules
- **改 patch 逻辑后必须双模式验证**：
  - `PI_TURBO_SERIAL=1 node bin/pi-tb.js` — 确认 kill-switch 回退正常
  - 正常模式 — 确认并行路径工作
- **改 mergeInOrder 或分区逻辑后**跑 `node test/smoke.mjs`
- **纯 ESM** — 所有文件用 `import/export`，不引入 CommonJS
- **无构建步骤** — 不要加 TypeScript、bundler、或任何编译环节
- **原子写入** — 任何写 `~/.pi-turbo/` 文件的操作必须 temp+rename，不可直接 write
- **Node >= 22.19.0** — 可使用该版本以上的 API，不可降级兼容

## 环境变量速查

| 变量 | 默认 | 作用 |
| ------ | ------ | ------ |
| `PI_TURBO_SERIAL=1` | — | kill-switch，强制串行（等同未安装） |
| `PI_TURBO_OFF=1` | — | 同上，完全跳过 patch |
| `PI_TURBO_CHUNK` | 4 | 每个并行块包含的扩展数 |
| `PI_TURBO_DEBUG=1` | — | 输出详细加载日志 |
| `PI_TURBO_PROFILE=1` | — | 忽略现有画像，强制重新 profiling |
| `PI_TURBO_NO_FOOTER=1` | — | 仅禁用 Footer 渲染缓存 |

## 运行时数据

- `~/.pi-turbo/state.json` — 持久化配置
- `~/.pi-turbo/per-ext-timings.json` — EMA 时序画像（自学习，勿手动编辑）

## 已知问题

- `test/ab-compare.mjs` 引用了不存在的 `../src/parallel-loader.js`（早期迭代遗留死代码），运行会报错
