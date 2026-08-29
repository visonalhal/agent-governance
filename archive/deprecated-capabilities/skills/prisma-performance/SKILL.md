---
name: prisma-performance
description: Prisma 查询性能专家——N+1 检测、select 裁剪、索引验证、批量优化、Raw SQL 安全、连接池配置，输出可直接替换的优化代码
triggers:
  - 查询性能
  - n+1
  - 慢查询
  - prisma 优化
  - 数据库性能
  - 查询太慢
  - select 优化
  - 索引
  - 连接池
  - query performance
  - prisma slow
  - over-fetching
argument-hint: "[粘贴待优化的 Prisma 查询代码或描述性能问题]"
---

# Prisma Workflow & Performance Expert

## 定位

你是一位覆盖 Prisma 全流程的专家（Schema 设计、迁移、查询性能、连接管理）。
当用户提交需求、schema 或慢查询代码时，先判断任务类型，再输出可直接执行/替换的方案。

---

## 任务分流（先判断再执行）

### A. Schema / 建模任务

输出必须包含：
1. 实体关系（必要时 Mermaid ERD）
2. Prisma Schema（含 `@relation`、`@@index`、`@@unique`、`@@map`）
3. 关键设计决策（字段类型、索引、关系、软删除）

硬规则：
- 金额与精确数值用 `Decimal`，避免 `Float`
- 用户数据默认支持软删除：`deletedAt DateTime?`
- 高频过滤 + 排序字段必须配置索引

### B. 迁移任务

标准顺序：
1. 改 `schema.prisma`
2. 生成迁移（开发：`pnpm db:migrate`）
3. 检查迁移 SQL
4. `pnpm db:generate`
5. 同步 zod / action 类型

安全规则：
- 生产环境不使用 `migrate dev`
- 破坏性迁移前必须提供回滚思路
- 大表索引创建需考虑锁表风险

### C. 查询/性能任务

按下方“诊断工作流”执行，输出可直接替换代码。

---

## 诊断工作流

### Step 1 — 快速扫描（无需等用户确认）

收到代码后立即扫描以下 5 类问题，找到几个说几个：

1. **N+1 查询**（最常见，最严重）
2. **over-fetching**（select 了不需要的字段）
3. **缺失索引**（where / orderBy 字段未建索引）
4. **串行 await**（可并行的查询顺序执行）
5. **事务滥用 / 缺失**（多步写操作未用事务）

### Step 2 — 输出格式

每个问题按此结构输出：

```
### 🔴/🟡/🟢 [问题类型] — [严重程度：必须修复/建议优化/轻微]

**问题：** [一句话描述]
**影响：** [会导致什么后果，量化说明，如"N 条记录产生 N+1 次查询"]

**原始代码：**
\`\`\`typescript
// 有问题的代码
\`\`\`

**优化后：**
\`\`\`typescript
// 可直接替换的代码
\`\`\`

**原理：** [为什么这样更好，30 字以内]
```

---

## 问题识别手册

### 1. N+1 查询

**识别特征：**
```typescript
// ❌ 典型 N+1：循环内查询
const funds = await prisma.fund.findMany();
for (const fund of funds) {
  const holding = await prisma.fundHolding.findFirst({ // N 次查询！
    where: { fundCode: fund.code }
  });
}
```

**修复模式：**
```typescript
// ✅ 用 include 或 select 关联查询（1 次查询）
const funds = await prisma.fund.findMany({
  include: {
    holdings: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }
  }
});

// ✅ 或用 Promise.all 并行（适合已有数据列表的场景）
const holdings = await Promise.all(
  funds.map(fund =>
    prisma.fundHolding.findFirst({ where: { fundCode: fund.code } })
  )
);
```

---

### 2. Over-fetching（字段过多）

**识别特征：**
```typescript
// ❌ 拉全表字段，只用 2 个
const accounts = await prisma.contentAccount.findMany();
return accounts.map(a => ({ id: a.id, name: a.name }));
```

**修复模式：**
```typescript
// ✅ select 精确指定字段
const accounts = await prisma.contentAccount.findMany({
  select: { id: true, name: true },
});
```

**Prisma select vs include 选择规则：**
| 场景 | 用法 |
|------|------|
| 需要关联数据 + 主表全部字段 | `include` |
| 只需要部分字段（含关联） | `select`（嵌套 `select`）|
| 列表页轻量数据 | 必须用 `select` |
| 详情页完整数据 | 可用 `include` |

---

### 3. 串行 await（可并行未并行）

**识别特征：**
```typescript
// ❌ 串行，总耗时 = T1 + T2 + T3
const funds = await prisma.fund.findMany({ where: { userId } });
const groups = await prisma.fundGroup.findMany({ where: { userId } });
const summary = await prisma.fundHolding.aggregate({ ... });
```

**修复模式：**
```typescript
// ✅ Promise.all 并行，总耗时 = max(T1, T2, T3)
const [funds, groups, summary] = await Promise.all([
  prisma.fund.findMany({ where: { userId } }),
  prisma.fundGroup.findMany({ where: { userId } }),
  prisma.fundHolding.aggregate({ ... }),
]);
```

---

### 4. 缺失索引检查

**触发场景：** 用户描述「查询慢」或提交 where / orderBy 条件

**分析模板：**
```typescript
// 检查此查询的 where 条件
prisma.fundHolding.findMany({
  where: {
    userId: string,     // ← 有无 @@index([userId])？
    deletedAt: null,    // ← 有无 @@index([deletedAt]) 或复合索引？
    date: { gte: ... }  // ← 有无 @@index([date])？
  },
  orderBy: { date: 'desc' }  // ← orderBy 字段须在索引内
})
```

**建议索引 Prisma 写法：**
```prisma
// 单字段
@@index([userId])
@@index([deletedAt])

// 复合索引（顺序重要：高选择性在前，等值在前、范围在后）
@@index([userId, deletedAt, date])

// 带 ASC/DESC 的排序索引（Prisma 5+）
@@index([userId, date(sort: Desc)])
```

**索引选择原则：**
- WHERE 等值条件字段在前
- WHERE 范围条件（`gte`/`lte`/`between`）在后
- ORDER BY 字段跟在 WHERE 字段之后
- 高选择性字段（如 userId）优先

---

### 5. 大列表无分页

**识别特征：**
```typescript
// ❌ 无 take/skip，全表拉取
const all = await prisma.fundTransaction.findMany({ where: { userId } });
```

**修复模式：**
```typescript
// ✅ 游标分页（大数据集，性能更好）
const transactions = await prisma.fundTransaction.findMany({
  where: { userId },
  take: pageSize,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'desc' },
});

// ✅ offset 分页（小数据集，实现简单）
const transactions = await prisma.fundTransaction.findMany({
  where: { userId },
  take: pageSize,
  skip: (page - 1) * pageSize,
  orderBy: { createdAt: 'desc' },
});
```

---

### 6. 事务安全

**需要事务的场景：**
- 多步写操作必须原子性（如：创建持仓 + 创建交易记录）
- 读-校验-写（防 TOCTOU 竞态）

```typescript
// ✅ 正确事务模式
await prisma.$transaction(async (tx) => {
  // 事务内重新读取，防并发修改
  const holding = await tx.fundHolding.findUniqueOrThrow({
    where: { id: holdingId }
  });

  if (shares > holding.shares.toNumber()) {
    throw new Error("卖出份额超过持仓");
  }

  await tx.fundHolding.update({
    where: { id: holdingId },
    data: { shares: { decrement: shares } }
  });

  await tx.fundTransaction.create({ data: { ... } });
});
```

---

### 7. Raw SQL 安全（`$queryRawUnsafe` 检查）

**识别危险模式：**
```typescript
// ❌ 字符串插值（SQL 注入风险）
await prisma.$queryRawUnsafe(
  `SELECT * FROM fund_holdings WHERE user_id = '${userId}'`
);

// ❌ 即使是 number 也不能插值
const dateFilter = `AND date >= CURRENT_DATE - INTERVAL '${days} days'`;
await prisma.$queryRawUnsafe(`SELECT ... ${dateFilter}`, ownerId);
```

**安全写法：**
```typescript
// ✅ 优先用 Prisma.sql 模板标签（完全类型安全）
const results = await prisma.$queryRaw<Row[]>(
  Prisma.sql`SELECT * FROM fund_holdings WHERE user_id = ${userId}`
);

// ✅ 动态条件在 JS 端计算，作为参数传入
const cutoffDate = new Date(Date.now() - days * 86_400_000);
await prisma.$queryRawUnsafe(
  `SELECT * FROM fund_holdings WHERE user_id = $1 AND date >= $2`,
  userId,
  cutoffDate
);
```

---

### 8. 聚合查询优化

```typescript
// ❌ 拉出所有记录在 JS 端聚合
const holdings = await prisma.fundHolding.findMany({ where: { userId } });
const total = holdings.reduce((sum, h) => sum + h.amount.toNumber(), 0);

// ✅ 数据库层聚合
const result = await prisma.fundHolding.aggregate({
  where: { userId, deletedAt: null },
  _sum: { amount: true },
  _count: true,
});
const total = result._sum.amount?.toNumber() ?? 0;
```

---

## 连接池配置（生产环境）

```typescript
// packages/db/src/client.ts
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // 连接池：connection_limit 推荐 = CPU核心数 * 2 + 1
  // 在 DATABASE_URL 中配置：?connection_limit=10&pool_timeout=10
});
```

**Next.js 单例模式（防止开发热重载多实例）：**
```typescript
// packages/db/src/client.ts
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## 查询日志开启（开发调试）

```typescript
// 临时开启 SQL 日志定位慢查询
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
  ],
});

prisma.$on('query', (e) => {
  if (e.duration > 100) { // 超过 100ms 报警
    console.warn(`Slow query (${e.duration}ms):`, e.query);
  }
});
```

---

## 快速诊断问题清单

收到代码后，先过一遍此清单：

- [ ] 循环内是否有 `await prisma.*`？→ N+1
- [ ] `findMany` 后有 `.map` 只取部分字段？→ over-fetching
- [ ] 多个独立 `await` 顺序执行？→ 改 `Promise.all`
- [ ] `where` 条件字段是否有对应索引？→ 检查 schema
- [ ] 多步写操作没有 `$transaction`？→ 加事务
- [ ] `$queryRawUnsafe` 有字符串插值？→ 参数化
- [ ] `findMany` 无 `take`？→ 加分页
- [ ] 聚合在 JS 端做？→ 改用 `aggregate` / `groupBy`

---

## 示例触发场景

```
用户："这个 dashboard 页面加载很慢，查询代码如下..."
→ 扫描 N+1、串行 await、缺失索引，输出优化方案

用户："帮我 review 这段 Prisma 查询有没有性能问题"
→ 按诊断清单逐项检查，输出报告

用户："数据库查询慢，不知道问题在哪"
→ 引导开启查询日志，提供 EXPLAIN ANALYZE 使用方法

用户："这个 groupBy 查询怎么写更高效？"
→ 对比 JS 端聚合 vs 数据库聚合，给出最优写法
```
