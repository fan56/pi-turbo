[English](README.md) | 中文

# pi-turbo

[pi](https://github.com/earendil-works/pi) 的性能加速包装器 — 两个运行时 monkey-patch，对 pi 本身零修改。

- **启动加速**：并行加载扩展（冷启动提速 33%）
- **运行时优化**：Footer 渲染缓存（消除长对话中按 Enter 的卡顿）

## 它解决什么问题（Problems it solves）

### 1. 启动慢（扩展加载）

**症状**：pi 启动需要 4-5 秒。你只能盯着空白终端，等扩展一个一个加载完。

**原因**：pi 串行加载所有扩展。部分扩展（如 MCP 握手）是 I/O 密集型的，CPU 全程空转等待。

**方案**：pi-turbo 对 `DefaultResourceLoader.loadFinalExtensionSet` 打补丁：

1. **画像**（首次运行）：逐个加载扩展，记录每个扩展的耗时（EMA）
2. **优化**（后续运行）：识别 I/O 密集扩展（EMA > 1000ms，如 MCP 握手），放入后台加载，CPU 密集扩展继续串行加载
3. **重叠**：I/O 等待与 CPU 工作并行执行 → 总耗时 = max(后台, 串行)

| 模式 | 扩展加载耗时 | 提速 |
| --- | --- | --- |
| 串行（pi 默认） | ~4660ms | — |
| **定向并行** | **~3125ms** | **33%** |

### 2. Enter 键卡顿（Footer O(n) 扫描）

**症状**：对话超过 100 条消息后，按 Enter 有明显延迟。对话越长，卡顿越严重。

**原因**：pi 的 Footer 每次渲染都重新扫描全部会话条目（O(n)）来计算 token 用量统计，加上 `getContextUsage()` 要做树遍历和对每条消息执行 `JSON.stringify`。

**方案**：pi-turbo 对 `SessionManager.getEntries()` 和 `AgentSession.getContextUsage()` 加智能缓存：

- `getEntries()`：返回缓存数组，仅在追加新条目时失效（O(1) vs O(n) 过滤 + 新数组分配）
- `getContextUsage()`：按条目数缓存，避免重复树遍历和 token 估算（O(1) vs O(n) + O(内容大小)）

## 对 pi 的影响（Impact on pi）

**零。** pi-turbo 不碰 pi 的源码、node_modules 或配置文件。

- 所有补丁都是原型方法上的运行时 monkey-patch
- 每个补丁都包在 try-catch 里 — 任何错误都回退到 pi 的原始行为
- kill-switch 可以独立禁用任何优化
- 卸载后不留痕迹；pi 和之前完全一样

唯一可观察到的区别：pi 启动更快，Footer 不再卡顿。

## 证据（Evidence）

### 启动：A/B 基准测试

20 个扩展，每种模式各跑 3 次：

串行基线 (`PI_TURBO_SERIAL=1`)：5140ms, 5000ms, 9251ms

并行（默认）：

```
⚡ pi-turbo: 20 exts in 6507ms (serial ~9432ms, saved 31%, 1 chunk)
⚡ pi-turbo: 20 exts in 8387ms (serial ~11489ms, saved 27%, 1 chunk)
⚡ pi-turbo: 20 exts in 9796ms (serial ~13797ms, saved 29%, 1 chunk)
```

> **注**："saved %" 按每次运行计算：(估算串行时间 - 实际并行时间) / 估算串行时间。估算串行时间 = 各扩展 EMA 画像之和。绝对时间随系统负载波动；比率才是稳定指标。

### 启动：EMA 画像

`pi-tb --status` 输出示例：

```
extensions/index.ts    2527ms  ← lean-ctx MCP 桥接（I/O 密集）
dist/index.js           309ms
其余 18 个扩展          <100ms
```

I/O 密集扩展（2527ms）放入后台块，与 CPU 密集扩展的串行加载并行执行。I/O 等待与 CPU 工作重叠，总耗时取决于两者中较慢的那个，而非两者之和。

### Footer：pi 源码中的 O(n) 扫描

代码级证据（无法通过基准测试量化，以下为 pi 源码路径）：

- `footer.js:80` — 每帧渲染调用 `sessionManager.getEntries()`
- `session-manager.js:980` — `getEntries()` 执行 `this.fileEntries.filter(e => e.type !== "session")` — 每次调用 O(n) 过滤 + 新数组分配
- `agent-session.js:2534` — `getContextUsage()` 执行 `getBranch()` O(n) 树遍历 + `estimateContextTokens` 对所有消息 `JSON.stringify`

`fileEntries` 只追加不删除，n 随对话增长。100+ 条消息后，每次按 Enter 触发 O(n) 扫描 + O(内容大小) 序列化 → 可感知卡顿。

**修复方式**：WeakMap 缓存，以 `fileEntries.length` 为键（利用只追加不变量）。缓存命中 = O(1)。缓存未命中（新条目追加）= 一次 O(n)，之后重新缓存。

## 安装（Install）

```bash
cd ~/github/pi-opt
./install.sh
```

### 从 pi-opt 升级

如果你之前安装过 pi-opt，直接重新运行 `./install.sh` 即可。它会：

- 移除旧的 `pi-opt` 全局命令
- 安装新的 `pi-tb` 命令
- 将时序数据从 `~/.pi-opt/` 迁移到 `~/.pi-turbo/`

## 使用（Usage）

```bash
pi-tb                          # 启动 pi，启用所有优化
pi-tb --status                 # 查看各扩展的时序统计
PI_TURBO_SERIAL=1 pi-tb        # 禁用启动优化（A/B 基线对比）
PI_TURBO_NO_FOOTER=1 pi-tb     # 仅禁用 Footer 缓存
```

## 卸载（Uninstall）

```bash
./uninstall.sh
```

## 工作原理（How it works）

pi-turbo 是一个轻量包装器，在运行时打两个 monkey-patch：

1. **扩展加载器** — 替换 `DefaultResourceLoader.prototype.loadFinalExtensionSet`，使用 EMA 时序画像识别 I/O 密集扩展并行加载。

2. **Footer 渲染缓存** — 包装 `SessionManager.prototype.getEntries` 和 `AgentSession.prototype.getContextUsage`，以条目数为键缓存结果，消除每帧渲染的 O(n) 扫描。

两个补丁都是 fail-safe 的：任何错误都回退到 pi 的原始行为。

## 文件（Files）

- `bin/pi-tb.js` — CLI 入口
- `src/patch.js` — monkey-patch 编排器
- `src/footer-patch.js` — Footer 渲染缓存
- `src/targeted-loader.js` — 定向并行加载算法
- `src/timing.js` — EMA 时序记录器
- `src/config.js` — 路径和常量
- `~/.pi-turbo/per-ext-timings.json` — 各扩展时序数据（自动创建）

## 环境变量（Environment variables）

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PI_TURBO_SERIAL=1` | — | kill-switch：强制串行加载扩展 |
| `PI_TURBO_OFF=1` | — | 完全跳过所有补丁 |
| `PI_TURBO_CHUNK` | 4 | 每个并行块包含的扩展数 |
| `PI_TURBO_DEBUG=1` | — | 输出详细加载日志 |
| `PI_TURBO_PROFILE=1` | — | 强制重新画像（忽略现有 EMA 数据） |
| `PI_TURBO_NO_FOOTER=1` | — | 仅禁用 Footer 缓存 |

## 系统要求（Requirements）

- Node.js >= 22.19.0
- pi (`@earendil-works/pi-coding-agent`) >= 0.50.0
