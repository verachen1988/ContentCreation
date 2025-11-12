# Creem 支付升级流程 - 数据库设计深度分析

**分析师**: 资深数据工程师 & 数据库架构师
**分析日期**: 2025-11-12
**技术栈**: Supabase (PostgreSQL), Next.js, Creem Payment Gateway

---

## 📋 执行摘要

本分析针对 Creem 支付升级流程中的数据库设计进行了全面评估，重点关注使用 `profiles` 表作为单一真相来源（Single Source of Truth）存储用户订阅状态的架构设计。

**核心架构特点**:
- ✅ 使用 `profiles.plan` 字段作为订阅状态的单一真相来源
- ✅ 通过 `webhook_events` 表实现 Insert-First 幂等性保证
- ✅ 三阶段流程：创建 Checkout → Webhook 履行 → 前端轮询同步

---

## 1️⃣ 数据模型设计分析

### 1.1 使用 `profiles` 表存储 `plan` 字段的合理性

#### ✅ 设计合理性评分：**8/10**

**合理的理由**:

1. **业务语义清晰**: `profiles` 表通常存储用户的"档案"或"画像"信息，订阅计划（plan）作为用户身份的一部分，语义上属于用户档案的范畴。

2. **查询性能优越**:
   ```sql
   -- 高频查询路径优化
   SELECT plan FROM profiles WHERE id = 'user-id';
   -- 单表查询，无需 JOIN，延迟最低
   ```

3. **权限检查便捷**: 在 API 路由中进行权限验证时，可以直接查询 `profiles` 表：
   ```typescript
   // app/api/checkout/route.ts
   const { data: profile } = await supabase
     .from('profiles')
     .select('plan')
     .eq('id', userId)
     .single();

   if (isUserPro(profile)) {
     return Response.json({ error: 'Already Pro' }, { status: 400 });
   }
   ```

4. **与 Supabase Auth 集成**:
   - Supabase Auth 创建用户时，通常会自动在 `public.users` 或 `public.profiles` 表中创建对应记录
   - `profiles.id` 通常是 `auth.users.id` 的外键，关系清晰

**推荐的表结构**:
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('anonymous', 'free', 'pro')),
  plan_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 核心索引（已包含在主键中）
CREATE INDEX idx_profiles_plan ON profiles(plan);
CREATE INDEX idx_profiles_plan_updated_at ON profiles(plan_updated_at);
```

---

### 1.2 为什么不应该使用 `users` 表？

#### 🔍 推测原因分析：

| 原因 | 说明 | 风险等级 |
|------|------|---------|
| **表归属权问题** | Supabase 的 `auth.users` 表由系统管理，不建议直接修改 | 🔴 高 |
| **职责分离原则** | `auth.users` 负责认证，`public.profiles` 负责业务数据 | 🟡 中 |
| **扩展性限制** | `auth.users` 表结构受限，无法灵活添加业务字段 | 🟡 中 |
| **RLS 策略复杂度** | `auth.users` 表的 Row Level Security 策略可能与业务需求冲突 | 🟠 中高 |

**推荐架构**:
```
auth.users (Supabase 管理)
    ↓ (1:1 关系)
public.profiles (业务管理)
    ↓ (包含 plan 字段)
```

**最佳实践**:
```sql
-- 使用 Trigger 自动创建 profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

### 1.3 是否需要单独的 `subscriptions` 或 `payments` 表？

#### ⚠️ 当前设计的缺陷：**缺少关键表结构**

**推荐增加两张表**:

#### 📊 表 1: `subscriptions` (订阅表)

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'paused')),

  -- Creem 相关字段
  creem_subscription_id TEXT UNIQUE,
  creem_customer_id TEXT,

  -- 时间字段
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,

  -- 审计字段
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 确保一个用户只有一个活跃订阅
  CONSTRAINT unique_active_subscription
    EXCLUDE (user_id WITH =)
    WHERE (status = 'active')
);

-- 索引
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_creem_id ON subscriptions(creem_subscription_id);
```

#### 💳 表 2: `payments` (支付记录表)

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,

  -- 支付信息
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),

  -- Creem 相关
  creem_payment_id TEXT UNIQUE NOT NULL,
  creem_invoice_id TEXT,

  -- 支付方式
  payment_method_type TEXT, -- card, paypal, etc.

  -- 时间字段
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- 元数据（存储 webhook 原始数据）
  metadata JSONB
);

-- 索引
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_creem_id ON payments(creem_payment_id);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
```

**为什么需要这两张表？**

1. **业务完整性**: `profiles.plan` 只记录"当前状态"，无法追溯历史
2. **财务审计**: 支付系统必须保留完整的交易记录（法律要求）
3. **故障恢复**: 如果数据不一致，可以从 `subscriptions` 和 `payments` 表重建状态
4. **分析需求**:
   - 月度收入报告（MRR）
   - 用户留存率分析
   - 流失预测

**数据关系图**:
```
profiles (当前状态 - 快速查询)
    ↓
subscriptions (订阅历史 - 完整记录)
    ↓
payments (支付历史 - 财务审计)
```

---

## 2️⃣ 单一真相来源（Single Source of Truth）分析

### 2.1 `profiles.plan` 作为 SSOT 的优缺点

#### ✅ 优点

| 优点 | 说明 | 价值评分 |
|------|------|---------|
| **查询性能卓越** | 单表查询，无需 JOIN，延迟 < 5ms | ⭐⭐⭐⭐⭐ |
| **代码简洁** | 业务逻辑中只需查询一个字段 | ⭐⭐⭐⭐⭐ |
| **缓存友好** | 可以轻松缓存整个 profile 对象 | ⭐⭐⭐⭐ |
| **原子性更新** | 单行更新，天然具备原子性 | ⭐⭐⭐⭐⭐ |
| **RLS 策略简单** | 用户只能看到自己的 profile | ⭐⭐⭐⭐ |

#### ⚠️ 缺点

| 缺点 | 说明 | 风险评分 |
|------|------|---------|
| **历史追溯困难** | 无法查询"用户何时升级到 Pro" | 🔴 高 |
| **数据恢复受限** | 如果数据被错误覆盖，无法回滚 | 🔴 高 |
| **审计合规性差** | 缺少支付系统必需的审计日志 | 🔴 高 |
| **状态不完整** | 无法区分 "active pro" vs "canceled pro" | 🟠 中 |
| **分析能力弱** | 无法进行订阅流失、收入等分析 | 🟠 中 |

---

### 2.2 如何确保没有其他地方也存储了订阅状态？

#### 🛡️ 数据一致性保障策略

**策略 1: 数据库约束 + Trigger**

```sql
-- 1. 使用 Trigger 同步 profiles.plan 和 subscriptions.status
CREATE OR REPLACE FUNCTION sync_profile_plan_from_subscription()
RETURNS TRIGGER AS $$
BEGIN
  -- 当订阅状态变为 active 时，更新 profile
  IF NEW.status = 'active' THEN
    UPDATE profiles
    SET
      plan = NEW.plan,
      plan_updated_at = NOW()
    WHERE id = NEW.user_id;
  ELSIF NEW.status IN ('canceled', 'past_due') THEN
    UPDATE profiles
    SET
      plan = 'free',
      plan_updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER subscription_status_changed
  AFTER INSERT OR UPDATE OF status ON subscriptions
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION sync_profile_plan_from_subscription();
```

**策略 2: 应用层验证**

```typescript
// lib/subscription-service.ts
export async function getUserPlan(userId: string): Promise<string> {
  // 方式 1: 直接从 profiles 读取（快速路径）
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  // 方式 2: 从 subscriptions 验证（可选，用于关键操作）
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, plan')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  // 数据一致性检查
  if (subscription && profile.plan !== subscription.plan) {
    console.error('Data inconsistency detected!', {
      userId,
      profilePlan: profile.plan,
      subscriptionPlan: subscription.plan
    });

    // 触发数据修复流程
    await repairDataInconsistency(userId);
  }

  return profile.plan;
}
```

**策略 3: 定期数据一致性检查（Cron Job）**

```sql
-- 查找不一致的数据
SELECT
  p.id,
  p.plan as profile_plan,
  s.plan as subscription_plan,
  s.status as subscription_status
FROM profiles p
LEFT JOIN subscriptions s ON s.user_id = p.id AND s.status = 'active'
WHERE
  -- Case 1: 有活跃订阅但 profile 不是 pro
  (s.status = 'active' AND s.plan = 'pro' AND p.plan != 'pro')
  OR
  -- Case 2: 没有活跃订阅但 profile 是 pro
  (s.status IS NULL AND p.plan = 'pro');
```

---

## 3️⃣ 数据一致性保证

### 3.1 `webhook_events` 表的 Insert-First 幂等设计

#### 🎯 核心机制：使用唯一约束防止重复处理

**推荐表结构**:

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 幂等性保证（Creem 的事件 ID 必须唯一）
  creem_event_id TEXT UNIQUE NOT NULL,

  -- 事件信息
  event_type TEXT NOT NULL, -- checkout.completed, subscription.updated, etc.
  event_object TEXT NOT NULL, -- 'checkout', 'subscription', 'payment'

  -- 处理状态
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'succeeded', 'failed')),

  -- 原始数据（便于调试和数据恢复）
  raw_event JSONB NOT NULL,

  -- 提取的关键字段（加速查询）
  user_id UUID REFERENCES profiles(id),
  metadata JSONB,

  -- 处理结果
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  retry_count INTEGER DEFAULT 0,

  -- 审计字段
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 关键索引
CREATE INDEX idx_webhook_events_creem_event_id ON webhook_events(creem_event_id);
CREATE INDEX idx_webhook_events_processing_status ON webhook_events(processing_status);
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at DESC);
```

#### 🔄 Insert-First 幂等流程实现

```typescript
// app/api/creem/webhook/route.ts
export async function POST(req: Request) {
  // 1️⃣ 验签
  const signature = req.headers.get('creem-signature');
  const rawBody = await req.text();

  if (!verifyCreemSignature(rawBody, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  // 2️⃣ Insert-First：尝试插入 webhook_events
  const { data: webhookEvent, error: insertError } = await supabase
    .from('webhook_events')
    .insert({
      creem_event_id: event.id, // 唯一约束字段
      event_type: event.type,
      event_object: event.object,
      raw_event: event,
      user_id: event.data?.metadata?.userId,
      metadata: event.data?.metadata,
      processing_status: 'pending'
    })
    .select()
    .single();

  // 3️⃣ 幂等性检查
  if (insertError?.code === '23505') { // PostgreSQL unique violation
    console.log(`Duplicate webhook event detected: ${event.id}`);

    // 检查是否已成功处理
    const { data: existingEvent } = await supabase
      .from('webhook_events')
      .select('processing_status')
      .eq('creem_event_id', event.id)
      .single();

    if (existingEvent?.processing_status === 'succeeded') {
      // 已成功处理，直接返回成功
      return Response.json({ received: true, idempotent: true });
    } else {
      // 处理失败或处理中，返回错误让 Creem 重试
      return Response.json(
        { error: 'Event still processing or failed' },
        { status: 409 }
      );
    }
  }

  // 4️⃣ 标记为处理中
  await supabase
    .from('webhook_events')
    .update({ processing_status: 'processing' })
    .eq('id', webhookEvent.id);

  try {
    // 5️⃣ 业务逻辑处理
    switch (event.object) {
      case 'checkout':
        await handleCheckoutCompleted(event);
        break;
      case 'subscription':
        await handleSubscriptionUpdated(event);
        break;
    }

    // 6️⃣ 标记为成功
    await supabase
      .from('webhook_events')
      .update({
        processing_status: 'succeeded',
        processed_at: new Date().toISOString()
      })
      .eq('id', webhookEvent.id);

    return Response.json({ received: true });

  } catch (error) {
    // 7️⃣ 处理失败，记录错误
    await supabase
      .from('webhook_events')
      .update({
        processing_status: 'failed',
        processing_error: error.message,
        retry_count: webhookEvent.retry_count + 1
      })
      .eq('id', webhookEvent.id);

    // 返回 500 让 Creem 重试
    return Response.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}
```

---

### 3.2 多次 Webhook 调用的状态保护

#### 🛡️ 问题：Creem 可能重复发送 webhook

**场景分析**:
```
T1: Creem 发送 webhook (event_id: evt_123)
T2: 服务器处理中...
T3: Creem 超时，重发 webhook (event_id: evt_123)
T4: 服务器处理完成
T5: Creem 再次重发 (event_id: evt_123)
```

**保护机制**:

1. **数据库层面**：UNIQUE 约束防止插入重复事件
2. **应用层面**：检查 `processing_status` 状态
3. **业务层面**：UPDATE 操作使用 WHERE 条件保护

```typescript
async function handleCheckoutCompleted(event: CreemEvent) {
  const userId = event.data.metadata.userId;

  // ✅ 方式 1: 使用条件更新（推荐）
  const { data, error } = await supabase
    .from('profiles')
    .update({
      plan: 'pro',
      plan_updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .eq('plan', 'free') // 🔒 只有当前是 free 才更新
    .select();

  if (data?.length === 0) {
    console.warn(`User ${userId} already upgraded or not in free plan`);
  }

  // ✅ 方式 2: 使用事务（更严格）
  await supabase.rpc('upgrade_user_to_pro', {
    p_user_id: userId,
    p_creem_event_id: event.id
  });
}
```

**数据库函数（事务保护）**:
```sql
CREATE OR REPLACE FUNCTION upgrade_user_to_pro(
  p_user_id UUID,
  p_creem_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
  v_old_plan TEXT;
BEGIN
  -- 开启事务（函数自动包裹在事务中）

  -- 1. 获取当前计划（加行锁）
  SELECT plan INTO v_old_plan
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE; -- 🔒 悲观锁

  -- 2. 检查是否需要更新
  IF v_old_plan = 'pro' THEN
    -- 已经是 Pro，幂等返回
    RETURN jsonb_build_object(
      'updated', false,
      'reason', 'already_pro',
      'old_plan', v_old_plan
    );
  END IF;

  -- 3. 更新 profiles
  UPDATE profiles
  SET
    plan = 'pro',
    plan_updated_at = NOW()
  WHERE id = p_user_id;

  -- 4. 创建订阅记录
  INSERT INTO subscriptions (
    user_id,
    plan,
    status,
    creem_event_id
  ) VALUES (
    p_user_id,
    'pro',
    'active',
    p_creem_event_id
  )
  ON CONFLICT (creem_event_id) DO NOTHING; -- 幂等性

  -- 5. 返回结果
  RETURN jsonb_build_object(
    'updated', true,
    'old_plan', v_old_plan,
    'new_plan', 'pro'
  );

  -- 异常自动回滚
  EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

---

### 3.3 是否需要事务保护？

#### ✅ 推荐：**必须使用事务**

**需要事务的场景**:

| 场景 | 操作 | 无事务风险 | 解决方案 |
|------|------|-----------|---------|
| Webhook 处理 | 插入 webhook_event + 更新 profile | 更新失败但事件标记为已处理 | BEGIN...COMMIT |
| 升级到 Pro | 更新 profile + 插入 subscription + 插入 payment | 部分成功导致数据不一致 | 数据库函数 |
| 降级/取消 | 更新 profile + 更新 subscription | 状态不一致 | BEGIN...COMMIT |
| 退款处理 | 更新 payment + 更新 subscription + 更新 profile | 账务错误 | 数据库函数 |

**Supabase 事务示例**:

```typescript
// 使用 Supabase RPC 调用数据库函数（推荐）
await supabase.rpc('process_checkout_completed', {
  p_event_id: event.id,
  p_user_id: userId,
  p_plan: 'pro',
  p_amount: event.data.amount
});

// 或使用原生 PostgreSQL 事务（需要 postgres 库）
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const client = await pool.connect();
try {
  await client.query('BEGIN');

  await client.query(
    'UPDATE profiles SET plan = $1 WHERE id = $2',
    ['pro', userId]
  );

  await client.query(
    'INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, $2, $3)',
    [userId, 'pro', 'active']
  );

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

---

## 4️⃣ 并发控制

### 4.1 同时收到多个 Webhook 事件的处理

#### 🔀 并发场景分析

**场景 1: 相同事件的重复发送**
```
Thread 1: INSERT webhook_event (evt_123) ✅
Thread 2: INSERT webhook_event (evt_123) ❌ (UNIQUE violation)
```
**解决方案**: UNIQUE 约束 + 幂等性检查（已实现）

**场景 2: 不同事件的并发处理**
```
Thread 1: UPDATE profiles SET plan='pro' WHERE id='user1'
Thread 2: UPDATE profiles SET plan='free' WHERE id='user1' (取消订阅)
```

**问题**: 两个事件的处理顺序可能与发生顺序不一致

---

### 4.2 锁机制选择

#### 🔒 悲观锁 vs 乐观锁

**推荐：根据场景选择**

| 场景 | 推荐锁 | 实现方式 |
|------|--------|---------|
| Webhook 处理（低并发） | 悲观锁 | `SELECT ... FOR UPDATE` |
| 用户查询（高并发） | 无锁 | 直接 SELECT |
| 批量更新 | 乐观锁 | 版本号字段 |

#### 悲观锁实现（推荐用于 Webhook）

```sql
-- 在数据库函数中使用
CREATE OR REPLACE FUNCTION process_subscription_event(
  p_user_id UUID,
  p_new_plan TEXT,
  p_event_timestamp TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  -- 🔒 加行级锁，阻塞其他并发事务
  SELECT * INTO v_profile
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  -- 检查事件时间顺序（防止旧事件覆盖新事件）
  IF v_profile.plan_updated_at IS NOT NULL
     AND v_profile.plan_updated_at > p_event_timestamp THEN
    -- 忽略过时事件
    RAISE NOTICE 'Ignoring outdated event';
    RETURN;
  END IF;

  -- 更新
  UPDATE profiles
  SET
    plan = p_new_plan,
    plan_updated_at = p_event_timestamp
  WHERE id = p_user_id;
END;
$$;
```

#### 乐观锁实现（可选）

```sql
-- 添加版本号字段
ALTER TABLE profiles ADD COLUMN version INTEGER DEFAULT 0;

-- 更新时检查版本号
UPDATE profiles
SET
  plan = 'pro',
  plan_updated_at = NOW(),
  version = version + 1
WHERE
  id = 'user-id'
  AND version = 5; -- 必须匹配当前版本号

-- 如果 affected_rows = 0，说明版本冲突，需要重试
```

**推荐策略**:
```typescript
async function updateProfileWithOptimisticLock(
  userId: string,
  newPlan: string,
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 1. 读取当前版本
    const { data: profile } = await supabase
      .from('profiles')
      .select('version, plan')
      .eq('id', userId)
      .single();

    // 2. 条件更新
    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan: newPlan,
        plan_updated_at: new Date().toISOString(),
        version: profile.version + 1
      })
      .eq('id', userId)
      .eq('version', profile.version) // 🔒 乐观锁
      .select();

    if (data && data.length > 0) {
      return { success: true };
    }

    // 版本冲突，等待后重试
    await sleep(100 * Math.pow(2, attempt)); // 指数退避
  }

  throw new Error('Failed to update after max retries');
}
```

---

### 4.3 事件顺序保证

#### ⏰ 问题：Webhook 到达顺序 ≠ 发生顺序

**示例**:
```
实际顺序:
  T1: 用户升级到 Pro (evt_100)
  T2: 用户取消订阅 (evt_101)

Webhook 到达顺序:
  T3: evt_101 到达并处理 → plan = 'free'
  T4: evt_100 到达并处理 → plan = 'pro' ❌ 错误！
```

**解决方案：基于时间戳的顺序校验**

```sql
ALTER TABLE profiles ADD COLUMN plan_updated_at TIMESTAMPTZ;

-- 更新时检查时间戳
CREATE OR REPLACE FUNCTION update_plan_if_newer(
  p_user_id UUID,
  p_new_plan TEXT,
  p_event_timestamp TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE profiles
  SET
    plan = p_new_plan,
    plan_updated_at = p_event_timestamp
  WHERE
    id = p_user_id
    AND (
      plan_updated_at IS NULL
      OR plan_updated_at < p_event_timestamp -- 🔒 只接受更新的事件
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
```

---

## 5️⃣ 审计和历史记录

### 5.1 如何追踪用户订阅状态的变更历史？

#### ⚠️ 当前设计缺陷：**无法追溯历史**

**问题**:
- `profiles.plan` 只保留最新状态
- 无法回答："用户在 2024-10-15 是什么计划？"
- 无法分析用户升级/降级路径

---

### 5.2 `webhook_events` 表是否足够？

#### 📊 评估：**部分足够，但需增强**

**现有能力**:
✅ 记录了所有 Creem 事件的原始数据
✅ 可以从 `raw_event` JSONB 字段重建历史
✅ 提供了审计日志的基础

**不足之处**:
❌ 查询性能差（需要解析 JSONB）
❌ 没有结构化的历史记录表
❌ 无法快速生成报表

---

### 5.3 推荐：增加审计表

#### 📋 表 3: `plan_change_history` (计划变更历史表)

```sql
CREATE TABLE plan_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 变更信息
  old_plan TEXT,
  new_plan TEXT NOT NULL,
  change_reason TEXT, -- 'upgrade', 'downgrade', 'cancellation', 'refund', etc.

  -- 来源追踪
  triggered_by TEXT NOT NULL, -- 'webhook', 'admin', 'cron', 'support'
  creem_event_id TEXT REFERENCES webhook_events(creem_event_id),

  -- 财务关联
  payment_id UUID REFERENCES payments(id),
  subscription_id UUID REFERENCES subscriptions(id),

  -- 时间戳
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_plan_history_user_id ON plan_change_history(user_id);
CREATE INDEX idx_plan_history_changed_at ON plan_change_history(changed_at DESC);
CREATE INDEX idx_plan_history_change_reason ON plan_change_history(change_reason);

-- 自动记录变更的 Trigger
CREATE OR REPLACE FUNCTION log_plan_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    INSERT INTO plan_change_history (
      user_id,
      old_plan,
      new_plan,
      triggered_by
    ) VALUES (
      NEW.id,
      OLD.plan,
      NEW.plan,
      'webhook' -- 可以从应用上下文传入
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER profile_plan_changed
  AFTER UPDATE OF plan ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION log_plan_change();
```

**查询示例**:

```sql
-- 1. 查询用户的订阅历史
SELECT
  changed_at,
  old_plan,
  new_plan,
  change_reason
FROM plan_change_history
WHERE user_id = 'user-123'
ORDER BY changed_at DESC;

-- 2. 查询特定时间点的用户计划
WITH latest_change AS (
  SELECT
    new_plan,
    ROW_NUMBER() OVER (ORDER BY changed_at DESC) as rn
  FROM plan_change_history
  WHERE
    user_id = 'user-123'
    AND changed_at <= '2024-10-15'::timestamp
)
SELECT new_plan as plan_at_date
FROM latest_change
WHERE rn = 1;

-- 3. 统计每月升级数量
SELECT
  DATE_TRUNC('month', changed_at) as month,
  COUNT(*) as upgrade_count
FROM plan_change_history
WHERE
  change_reason = 'upgrade'
  AND new_plan = 'pro'
GROUP BY month
ORDER BY month DESC;
```

---

## 6️⃣ 数据库性能

### 6.1 频繁轮询的性能瓶颈分析

#### 🚨 问题：前端轮询造成的负载

**当前流程**:
```typescript
// success/page.tsx
useEffect(() => {
  const interval = setInterval(async () => {
    const response = await fetch('/api/user/me');
    const user = await response.json();

    if (user.plan === 'pro') {
      clearInterval(interval);
      // 升级成功
    }
  }, 1000); // 每秒查询一次
}, []);
```

**性能问题**:
- 每个等待升级的用户每秒 1 次查询
- 100 个并发用户 = 100 QPS
- 数据库连接池可能耗尽

---

### 6.2 性能优化方案

#### ✅ 方案 1: 实时订阅（推荐）

使用 Supabase Realtime 替代轮询：

```typescript
// success/page.tsx
import { createClient } from '@/lib/supabase-client';

useEffect(() => {
  const supabase = createClient();

  // 订阅 profiles 表的变更
  const channel = supabase
    .channel('profile-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`
      },
      (payload) => {
        if (payload.new.plan === 'pro') {
          // 升级成功
          setIsPro(true);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [userId]);
```

**优势**:
- ✅ 零轮询，降低数据库负载 95%+
- ✅ 实时响应（< 100ms 延迟）
- ✅ WebSocket 连接，节省 HTTP 开销

---

#### ✅ 方案 2: 缓存层（Redis）

```typescript
// lib/cache.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN
});

export async function getUserPlan(userId: string): Promise<string> {
  // 1. 尝试从缓存读取
  const cached = await redis.get(`user:${userId}:plan`);
  if (cached) {
    return cached as string;
  }

  // 2. 从数据库读取
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  // 3. 写入缓存（TTL 60秒）
  await redis.set(
    `user:${userId}:plan`,
    profile.plan,
    { ex: 60 }
  );

  return profile.plan;
}

// Webhook 处理后主动失效缓存
export async function invalidateUserPlanCache(userId: string) {
  await redis.del(`user:${userId}:plan`);
}
```

**在 Webhook 处理中使用**:
```typescript
async function handleCheckoutCompleted(event: CreemEvent) {
  const userId = event.data.metadata.userId;

  await supabase
    .from('profiles')
    .update({ plan: 'pro' })
    .eq('id', userId);

  // 🔥 主动失效缓存
  await invalidateUserPlanCache(userId);

  // 🔥 可选：通过 Redis Pub/Sub 通知前端
  await redis.publish('user-upgrades', JSON.stringify({
    userId,
    plan: 'pro',
    timestamp: Date.now()
  }));
}
```

---

#### ✅ 方案 3: 智能轮询（降级方案）

如果无法使用实时订阅，优化轮询策略：

```typescript
// success/page.tsx
useEffect(() => {
  let pollInterval = 1000; // 初始 1 秒
  let attempts = 0;
  const maxAttempts = 60; // 最多轮询 60 次

  const poll = async () => {
    if (attempts >= maxAttempts) {
      // 超时处理
      setError('Upgrade verification timeout');
      return;
    }

    const response = await fetch('/api/user/me');
    const user = await response.json();

    if (user.plan === 'pro') {
      setIsPro(true);
      return; // 成功，停止轮询
    }

    attempts++;

    // 🔥 指数退避：1s → 2s → 4s → 8s (最大 10s)
    pollInterval = Math.min(pollInterval * 1.5, 10000);

    setTimeout(poll, pollInterval);
  };

  poll();
}, []);
```

---

### 6.3 数据库索引优化

#### 📊 必需索引

```sql
-- 1. profiles 表
CREATE INDEX idx_profiles_plan ON profiles(plan); -- 按计划过滤
CREATE INDEX idx_profiles_plan_updated_at ON profiles(plan_updated_at DESC); -- 时间排序

-- 2. webhook_events 表
CREATE UNIQUE INDEX idx_webhook_creem_event_id ON webhook_events(creem_event_id); -- 幂等性
CREATE INDEX idx_webhook_processing_status ON webhook_events(processing_status)
  WHERE processing_status IN ('pending', 'failed'); -- 部分索引，只索引需要重试的记录
CREATE INDEX idx_webhook_created_at ON webhook_events(created_at DESC); -- 审计查询

-- 3. subscriptions 表
CREATE INDEX idx_subscriptions_user_status ON subscriptions(user_id, status); -- 复合索引
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end)
  WHERE status = 'active'; -- 部分索引，用于过期检查

-- 4. payments 表
CREATE INDEX idx_payments_user_created ON payments(user_id, created_at DESC); -- 用户支付历史
CREATE INDEX idx_payments_status ON payments(status); -- 支付状态过滤
```

---

### 6.4 查询性能监控

#### 📈 使用 pg_stat_statements

```sql
-- 启用扩展
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查询最慢的 10 条 SQL
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time,
  total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 查询最频繁的查询
SELECT
  query,
  calls,
  mean_exec_time
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;
```

---

## 📊 总结与评分

### ✅ 数据设计优点

| # | 优点 | 说明 | 价值 |
|---|------|------|------|
| 1 | **查询性能卓越** | 单表查询 `profiles.plan`，延迟 < 5ms，无需 JOIN | ⭐⭐⭐⭐⭐ |
| 2 | **代码简洁性高** | 业务逻辑清晰，权限检查直观（`isUserPro(profile)`） | ⭐⭐⭐⭐⭐ |
| 3 | **幂等性设计优雅** | Insert-First + UNIQUE 约束，防止重复处理 | ⭐⭐⭐⭐⭐ |
| 4 | **数据库原子性** | 单行更新天然具备原子性，减少并发问题 | ⭐⭐⭐⭐ |
| 5 | **与 Supabase 集成良好** | `profiles` 表与 `auth.users` 的 1:1 关系符合 Supabase 最佳实践 | ⭐⭐⭐⭐⭐ |
| 6 | **RLS 策略简单** | 用户只能访问自己的 profile，安全模型清晰 | ⭐⭐⭐⭐ |
| 7 | **扩展性好** | 未来可以在 `profiles` 表添加更多用户属性字段 | ⭐⭐⭐⭐ |

---

### ⚠️ 数据设计缺陷或风险

| # | 缺陷/风险 | 说明 | 风险等级 |
|---|----------|------|---------|
| 1 | **缺少历史追溯能力** | `profiles.plan` 只保留最新状态，无法查询历史变更 | 🔴 高 |
| 2 | **审计合规性不足** | 支付系统需要完整的交易记录，当前设计不满足财务审计要求 | 🔴 高 |
| 3 | **数据恢复能力弱** | 如果 `profiles.plan` 被错误覆盖，无法从备份恢复 | 🔴 高 |
| 4 | **缺少订阅详细信息** | 无法存储订阅的开始/结束时间、取消原因等关键信息 | 🟠 中高 |
| 5 | **轮询性能瓶颈** | 前端频繁轮询可能导致数据库连接池耗尽 | 🟠 中高 |
| 6 | **并发控制不足** | 没有明确的锁机制，可能导致事件乱序问题 | 🟠 中高 |
| 7 | **缺少支付记录表** | 无法追踪每笔支付的详细信息（金额、时间、支付方式等） | 🟡 中 |
| 8 | **缺少时间戳校验** | 没有基于时间戳的事件顺序校验机制 | 🟡 中 |

---

### 🔧 改进建议

#### 建议 1: 增加必要的数据表

```sql
-- ✅ 1. subscriptions 表（订阅管理）
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'paused')),
  creem_subscription_id TEXT UNIQUE,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ✅ 2. payments 表（支付记录）
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  subscription_id UUID REFERENCES subscriptions(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  creem_payment_id TEXT UNIQUE NOT NULL,
  paid_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ✅ 3. plan_change_history 表（审计日志）
CREATE TABLE plan_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  old_plan TEXT,
  new_plan TEXT NOT NULL,
  change_reason TEXT,
  triggered_by TEXT NOT NULL,
  creem_event_id TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

#### 建议 2: 强化 profiles 表

```sql
-- 添加审计字段
ALTER TABLE profiles
  ADD COLUMN plan_updated_at TIMESTAMPTZ,
  ADD COLUMN version INTEGER DEFAULT 0, -- 乐观锁
  ADD COLUMN metadata JSONB; -- 存储额外信息

-- 添加检查约束
ALTER TABLE profiles
  ADD CONSTRAINT valid_plan CHECK (plan IN ('anonymous', 'free', 'pro'));
```

---

#### 建议 3: 完善 webhook_events 表

```sql
ALTER TABLE webhook_events
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_completed_at TIMESTAMPTZ,
  ADD COLUMN idempotency_key TEXT, -- 额外的幂等性标识
  ADD COLUMN event_timestamp TIMESTAMPTZ; -- Creem 事件的实际时间

-- 添加索引
CREATE INDEX idx_webhook_event_timestamp
  ON webhook_events(event_timestamp DESC);

CREATE INDEX idx_webhook_retry_needed
  ON webhook_events(processing_status, retry_count)
  WHERE processing_status = 'failed' AND retry_count < 3;
```

---

#### 建议 4: 实现数据同步 Trigger

```sql
-- 自动同步 profiles.plan 和 subscriptions.status
CREATE OR REPLACE FUNCTION sync_profile_from_subscription()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.plan = 'pro' THEN
    UPDATE profiles
    SET
      plan = 'pro',
      plan_updated_at = NOW()
    WHERE id = NEW.user_id;
  ELSIF NEW.status IN ('canceled', 'past_due') THEN
    UPDATE profiles
    SET
      plan = 'free',
      plan_updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER subscription_status_sync
  AFTER INSERT OR UPDATE OF status ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_from_subscription();
```

---

#### 建议 5: 使用数据库函数封装业务逻辑

```sql
-- 统一的订阅升级函数
CREATE OR REPLACE FUNCTION upgrade_user_subscription(
  p_user_id UUID,
  p_creem_subscription_id TEXT,
  p_creem_event_id TEXT,
  p_event_timestamp TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- 开启事务
  BEGIN
    -- 1. 更新 profile（带时间戳检查）
    UPDATE profiles
    SET
      plan = 'pro',
      plan_updated_at = p_event_timestamp
    WHERE
      id = p_user_id
      AND (plan_updated_at IS NULL OR plan_updated_at < p_event_timestamp)
      FOR UPDATE;

    -- 2. 创建/更新订阅
    INSERT INTO subscriptions (
      user_id,
      plan,
      status,
      creem_subscription_id
    ) VALUES (
      p_user_id,
      'pro',
      'active',
      p_creem_subscription_id
    )
    ON CONFLICT (creem_subscription_id)
    DO UPDATE SET status = 'active';

    -- 3. 记录审计日志（由 Trigger 自动完成）

    RETURN jsonb_build_object(
      'success', true,
      'user_id', p_user_id,
      'plan', 'pro'
    );

  EXCEPTION WHEN OTHERS THEN
    -- 回滚并返回错误
    RAISE;
  END;
END;
$$;
```

---

#### 建议 6: 性能优化 - 使用实时订阅替代轮询

```typescript
// ❌ 旧方案：轮询
setInterval(async () => {
  const user = await fetch('/api/user/me');
  // ...
}, 1000);

// ✅ 新方案：Supabase Realtime
const channel = supabase
  .channel('profile-changes')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'profiles',
      filter: `id=eq.${userId}`
    },
    (payload) => {
      if (payload.new.plan === 'pro') {
        // 实时响应
      }
    }
  )
  .subscribe();
```

---

#### 建议 7: 增加缓存层

```typescript
// 使用 Redis 缓存用户计划
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN
});

async function getUserPlan(userId: string) {
  // 1. 尝试缓存
  const cached = await redis.get(`user:${userId}:plan`);
  if (cached) return cached;

  // 2. 查询数据库
  const { data } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  // 3. 写入缓存（TTL 60秒）
  await redis.set(`user:${userId}:plan`, data.plan, { ex: 60 });

  return data.plan;
}

// Webhook 处理后失效缓存
async function handleCheckoutCompleted(event) {
  // ... 更新数据库 ...

  // 失效缓存
  await redis.del(`user:${userId}:plan`);
}
```

---

#### 建议 8: 添加监控和告警

```sql
-- 创建监控视图
CREATE VIEW webhook_health_metrics AS
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  processing_status,
  COUNT(*) as event_count,
  AVG(EXTRACT(EPOCH FROM (processed_at - received_at))) as avg_processing_time_seconds
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, processing_status
ORDER BY hour DESC;

-- 查询失败率
SELECT
  processing_status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY processing_status;
```

---

#### 建议 9: 数据一致性校验脚本

```sql
-- 定期运行的一致性检查
CREATE OR REPLACE FUNCTION check_data_consistency()
RETURNS TABLE (
  user_id UUID,
  issue TEXT,
  profile_plan TEXT,
  subscription_status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY

  -- 检查 1: 有活跃订阅但不是 Pro
  SELECT
    p.id,
    'Has active subscription but not Pro' as issue,
    p.plan,
    s.status
  FROM profiles p
  INNER JOIN subscriptions s ON s.user_id = p.id
  WHERE
    s.status = 'active'
    AND s.plan = 'pro'
    AND p.plan != 'pro'

  UNION ALL

  -- 检查 2: 是 Pro 但没有活跃订阅
  SELECT
    p.id,
    'Is Pro but no active subscription' as issue,
    p.plan,
    NULL
  FROM profiles p
  LEFT JOIN subscriptions s ON s.user_id = p.id AND s.status = 'active'
  WHERE
    p.plan = 'pro'
    AND s.id IS NULL;
END;
$$;

-- 运行检查
SELECT * FROM check_data_consistency();
```

---

#### 建议 10: 回退和数据恢复机制

```sql
-- 创建回退函数
CREATE OR REPLACE FUNCTION rollback_user_upgrade(
  p_user_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. 回退 profile
  UPDATE profiles
  SET
    plan = 'free',
    plan_updated_at = NOW()
  WHERE id = p_user_id;

  -- 2. 取消订阅
  UPDATE subscriptions
  SET
    status = 'canceled',
    canceled_at = NOW()
  WHERE
    user_id = p_user_id
    AND status = 'active';

  -- 3. 记录回退原因
  INSERT INTO plan_change_history (
    user_id,
    old_plan,
    new_plan,
    change_reason,
    triggered_by
  ) VALUES (
    p_user_id,
    'pro',
    'free',
    p_reason,
    'admin_rollback'
  );
END;
$$;
```

---

## 🎯 最终评分与建议

### 综合评分

| 维度 | 当前分数 | 满分 | 评级 |
|------|---------|------|------|
| **数据模型设计** | 7/10 | 10 | 🟡 良好 |
| **单一真相来源** | 8/10 | 10 | 🟢 优秀 |
| **数据一致性保证** | 6/10 | 10 | 🟡 及格 |
| **并发控制** | 5/10 | 10 | 🟠 需改进 |
| **审计和历史记录** | 4/10 | 10 | 🔴 不足 |
| **数据库性能** | 6/10 | 10 | 🟡 及格 |
| **整体评分** | **6.0/10** | **10** | **🟡 中等偏上** |

---

### 优先级建议

#### 🔴 P0 - 必须立即实施

1. **增加 `subscriptions` 表**（财务合规必需）
2. **增加 `payments` 表**（审计必需）
3. **实现事务保护**（数据一致性必需）
4. **添加时间戳校验**（防止事件乱序）

#### 🟠 P1 - 强烈建议在 MVP 后立即实施

5. **增加 `plan_change_history` 表**（审计日志）
6. **实现实时订阅**（替代轮询）
7. **添加缓存层**（性能优化）
8. **完善并发控制**（悲观锁/乐观锁）

#### 🟡 P2 - 中期优化

9. **监控和告警系统**
10. **数据一致性校验脚本**
11. **自动化测试（Webhook 重放）**

---

## 📚 参考资源

1. **Supabase 最佳实践**
   https://supabase.com/docs/guides/database/design

2. **PostgreSQL 并发控制**
   https://www.postgresql.org/docs/current/mvcc.html

3. **Stripe Webhook 最佳实践**（可参考）
   https://stripe.com/docs/webhooks/best-practices

4. **支付系统数据库设计**
   https://www.cybersource.com/en-us/solutions/payment-security/pci-compliance.html

---

**文档版本**: 1.0
**最后更新**: 2025-11-12
**审核人**: 资深数据工程师 & 数据库架构师
