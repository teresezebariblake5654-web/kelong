# 奶牛养成：活力 / 饿死 / 积分复活

## 与主应用隔离（≠ 收不到信号）

隔离的是**副作用**，不是**观察**：

| 仍会响应 | 怎么接的 |
|----------|----------|
| 用 Agent | 只读 Redux `isStreaming` / `session.status` |
| 打开 App | `visibilitychange` + 前台停留 |
| 扣积分 | 只读拉余额差值；听 `workstation:credits-changed`；可选 `notifyCowPetCreditsConsumed(n)` |
| 复活进度 | 死亡后余额下降累计 / 完成会话次数 |

不碰的：

- 开关：`COW_PET_ENABLED=false` 整层不挂载
- Portal + `pointer-events: none`（不挡点击）
- 独立 `fetch` 查余额（401 不踢登录）
- 不写 Redux / 不改会话 / 不走支付链路

可调常量见 [`petVitality.ts`](./petVitality.ts) 文件顶部导出：

| 常量 | 默认 | 含义 |
|------|------|------|
| `DECAY_FULL_DAYS` | 1 | 完全不用约几天饿死 |
| `HUNGRY_BELOW` | 30 | 低于此显示「好饿」 |
| `REVIVE_FLOOR_CREDITS` | 300 | 复活费用下限 |
| `FOREGROUND_MIN_MS` | 30000 | 前台停留多久算有效打开 |
| `LIGHT_FEED_PER_HOUR` | 10 | 挂机轻喂每次 +HP |
| `OFFLINE_REVIVE_SESSIONS` | 12 | 未登录时完成会话复活次数（偏难） |

复活费用：`max(REVIVE_FLOOR_CREDITS, floor(死亡时积分余额 × 0.1))`。

## 本地模拟验收

1. DevTools → Application → Local Storage → 键 `cowPet.vitality`
2. 把 JSON 里 `lastFedAt` / `lastDecayAt` 改成 `Date.now() - 5*86400000`，`vitality` 改成 `100`，刷新
3. 等一分钟 tick 或切前后台：应变为 **dead**（葬送了…）
4. 未登录：完成 12 次 Agent 会话 → **reviving** 进度 → 复活
5. 已登录：死亡后产生积分扣费（余额下降）→ 进度环上涨，达到费用后复活
6. 正常每天打开 App ≥30s 或跑 Agent：应保持 **alive**，HP 回满

调试重置：删除 `cowPet.vitality` 即恢复满血新生。
