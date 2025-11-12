# Creem 支付升级流程 - 安全分析报告

**分析日期**: 2025-11-12
**分析人员**: 资深安全工程师
**目标系统**: ContentCreation - Creem 支付升级流程

---

## 执行摘要

本报告对 Creem 支付升级流程进行了全面的安全评估，从认证授权、Webhook 安全、数据完整性、CSRF/XSS 防护、竞态条件和信息泄露六个维度进行了深入分析。整体架构采用了多层防御设计，但仍存在若干需要关注的安全隐患。

**风险等级**: 中等（MEDIUM）
**主要优势**: 双重认证护栏、Webhook 验签、幂等性设计
**关键风险**: metadata.userId 信任问题、竞态条件、错误信息泄露

---

## 1. 数据流图分析

```
用户点击 Upgrade
↓
[前端] UpgradeDialog
↓
useAuth() 检查 isPro === true？(✅ 护栏)
↓
[API] POST /api/checkout
↓
(服务端) supabase.auth.getUser()
↓
(服务端) SELECT plan FROM profiles
↓
isUserPro(profile) === true？(✅ 服务器护栏)
↓
创建 Creem Checkout (注入 metadata.userId)
↓
[Creem] → 用户支付 → 重定向回 /upgrade/success

[并行] [API] POST /api/creem/webhook (流程 2: 履行)
↓
验签
↓
幂等 (Insert-First 到 webhook_events)
↓
switch (event.object)
↓
UPDATE profiles SET plan = 'pro' WHERE id = metadata.userId
(✅ 单一真相被更新)

[前端] success/page.tsx (流程 3: 同步)
↓
useEffect 触发轮询
↓
GET /api/user/me (轮询 1、2...)
```

---

## 2. 安全优点分析

### ✅ 2.1 双重认证护栏 (Defense in Depth)

**优势描述**:
- **前端护栏**: `useAuth().isPro` 在 UI 层阻止已付费用户重复升级
- **服务端护栏**: `/api/checkout` 中 `isUserPro(profile)` 提供二次验证
- **安全价值**: 即使前端被绕过（浏览器开发者工具篡改），服务端仍能阻止无效请求

**实施细节**:
```typescript
// 前端 - UpgradeDialog.tsx
const { isPro } = useAuth();
if (isPro) {
  toast.error("您已经是 Pro 用户");
  return;
}

// 服务端 - /api/checkout/route.ts
const profile = await getProfile(userId);
if (isUserPro(profile)) {
  return NextResponse.json(
    { error: "Already a Pro user" },
    { status: 400 }
  );
}
```

**防御能力**: 防止重复支付、降低业务逻辑错误

---

### ✅ 2.2 Webhook 验签机制

**优势描述**:
- Webhook 接收后立即进行签名验证
- 防止伪造的支付完成事件
- 确保事件确实来自 Creem 官方服务器

**实施细节**:
```typescript
// /api/creem/webhook/route.ts
const signature = request.headers.get('x-creem-signature');
const payload = await request.text();

const isValid = verifyCreemSignature(payload, signature, CREEM_WEBHOOK_SECRET);
if (!isValid) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
}
```

**防御能力**: 防止攻击者伪造支付成功事件，阻止未授权的账户升级

---

### ✅ 2.3 幂等性设计 (Insert-First Pattern)

**优势描述**:
- 采用 `webhook_events` 表记录所有收到的事件
- 使用 `event_id` 作为唯一键，防止同一事件被处理多次
- 避免重复计费或多次升级同一账户

**实施细节**:
```typescript
// Insert-First 幂等性保证
const { error } = await supabase
  .from('webhook_events')
  .insert({
    event_id: event.id,
    event_type: event.type,
    payload: event,
    processed: false
  });

if (error && error.code === '23505') { // Unique constraint violation
  console.log(`Event ${event.id} already processed`);
  return NextResponse.json({ received: true }, { status: 200 });
}
```

**防御能力**: 防止重放攻击、网络重试导致的重复处理

---

### ✅ 2.4 Session-Based 身份验证

**优势描述**:
- 使用 Supabase Auth 的 `getUser()` 从 JWT Token 中获取用户身份
- 服务端不依赖客户端传递的 `userId` 参数
- 防止用户 A 冒充用户 B 发起支付

**实施细节**:
```typescript
// /api/checkout/route.ts
const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// 使用经过验证的 user.id
const checkoutSession = await createCreemCheckout({
  metadata: {
    userId: user.id // ✅ 来自 JWT，不可伪造
  }
});
```

**防御能力**: 防止身份伪造、确保支付与正确的用户账户关联

---

### ✅ 2.5 单一真相来源 (Single Source of Truth)

**优势描述**:
- 用户的 Pro 状态仅存储在 `profiles` 表的 `plan` 字段
- Webhook 直接更新此字段，无需中间状态同步
- 前端轮询 `/api/user/me` 从同一数据源读取状态

**实施细节**:
```sql
-- profiles 表结构
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  plan TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook 更新语句
UPDATE profiles
SET plan = 'pro', updated_at = NOW()
WHERE id = $1;
```

**防御能力**: 避免数据不一致、简化状态同步逻辑

---

### ✅ 2.6 HTTPS 强制加密

**优势描述**:
- 所有 API 通信（包括 Webhook）强制使用 HTTPS
- Supabase 和 Creem 均使用 TLS 1.2+ 加密传输
- 防止中间人攻击（MITM）窃取支付信息

**防御能力**: 保护敏感数据传输安全

---

### ✅ 2.7 轮询机制的合理性

**优势描述**:
- 前端不直接信任重定向 URL 的状态
- 通过轮询 `/api/user/me` 从服务端获取最新的 `plan` 状态
- 即使 Webhook 延迟，用户最终也能看到正确的状态

**实施细节**:
```typescript
// success/page.tsx
useEffect(() => {
  const pollInterval = setInterval(async () => {
    const response = await fetch('/api/user/me');
    const data = await response.json();

    if (data.plan === 'pro') {
      clearInterval(pollInterval);
      setUpgradeComplete(true);
    }
  }, 2000); // 每 2 秒轮询一次

  return () => clearInterval(pollInterval);
}, []);
```

**防御能力**: 避免依赖不可信的客户端状态

---

## 3. 安全隐患分析

### ⚠️ 3.1 metadata.userId 的信任边界问题（高风险）

**风险描述**:
虽然 `/api/checkout` 中从 JWT 获取 `userId` 是安全的，但该 ID 会被传递到 Creem 的 `metadata` 中，然后在 Webhook 回调时被用来更新数据库。如果 Creem 的 API 存在漏洞，或者 metadata 可以被篡改，可能导致：

**攻击场景**:
1. 攻击者通过某种方式（如抓包、中间人攻击）篡改 Creem Checkout Session 的 `metadata.userId`
2. 篡改后的 Session 指向受害者的 `userId`
3. 攻击者完成支付后，Webhook 会将受害者的账户升级为 Pro
4. 攻击者获得免费的 Pro 账户，受害者被错误升级

**漏洞根源**:
- 依赖第三方服务（Creem）保护 metadata 的完整性
- 没有在 Webhook 回调中验证支付的发起者是否与 metadata.userId 一致

**影响范围**:
- 业务逻辑绕过
- 未授权账户升级
- 财务损失

**CVSS 评分**: 7.5 (High)

**缓解建议**:
```typescript
// 方案 1: 添加 HMAC 签名到 metadata
const userIdHmac = createHmac('sha256', SERVER_SECRET)
  .update(user.id)
  .digest('hex');

await createCreemCheckout({
  metadata: {
    userId: user.id,
    userIdHmac: userIdHmac.substring(0, 16) // 截取前 16 字符
  }
});

// Webhook 中验证
const expectedHmac = createHmac('sha256', SERVER_SECRET)
  .update(event.metadata.userId)
  .digest('hex')
  .substring(0, 16);

if (event.metadata.userIdHmac !== expectedHmac) {
  throw new Error('Invalid userId in metadata');
}

// 方案 2: 使用数据库映射表
// 创建 checkout 时记录映射关系
await supabase.from('checkout_sessions').insert({
  session_id: creemSessionId,
  user_id: user.id,
  created_at: new Date()
});

// Webhook 中查询映射关系
const { data } = await supabase
  .from('checkout_sessions')
  .select('user_id')
  .eq('session_id', event.checkout_session_id)
  .single();

if (data.user_id !== event.metadata.userId) {
  throw new Error('userId mismatch');
}
```

---

### ⚠️ 3.2 Webhook 重放攻击的时间窗口（中风险）

**风险描述**:
虽然使用了 `Insert-First` 幂等性设计，但在数据库插入和状态更新之间存在时间窗口，可能导致：

**攻击场景**:
1. 攻击者捕获合法的 Webhook 请求（包含有效签名）
2. 在短时间内重复发送该请求（竞态条件）
3. 如果两个请求同时到达，可能绕过唯一键检查
4. 导致多次执行 `UPDATE profiles SET plan = 'pro'`（虽然结果相同，但可能触发其他副作用，如发送多封欢迎邮件）

**漏洞根源**:
- 数据库事务隔离级别不足
- 缺少分布式锁机制

**影响范围**:
- 可能触发重复的副作用（邮件通知、日志记录）
- 数据库写入压力

**CVSS 评分**: 5.3 (Medium)

**缓解建议**:
```typescript
// 方案 1: 使用数据库事务和 FOR UPDATE 锁
const { data, error } = await supabase.rpc('process_webhook_event', {
  event_id: event.id,
  user_id: event.metadata.userId,
  event_type: event.type
});

// PostgreSQL 存储过程
CREATE OR REPLACE FUNCTION process_webhook_event(
  event_id TEXT,
  user_id UUID,
  event_type TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  -- 插入事件记录（唯一键约束）
  INSERT INTO webhook_events (event_id, event_type, processed)
  VALUES (event_id, event_type, FALSE);

  -- 更新用户状态
  UPDATE profiles
  SET plan = 'pro', updated_at = NOW()
  WHERE id = user_id;

  -- 标记为已处理
  UPDATE webhook_events
  SET processed = TRUE
  WHERE event_id = event_id;

  RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
  -- 已处理过，直接返回
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

// 方案 2: 使用 Redis 分布式锁
const lockKey = `webhook:lock:${event.id}`;
const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');

if (!acquired) {
  return NextResponse.json({ received: true }, { status: 200 });
}

try {
  // 处理 Webhook
  await processWebhook(event);
} finally {
  await redis.del(lockKey);
}
```

---

### ⚠️ 3.3 前端轮询的竞态条件（中风险）

**风险描述**:
用户在 `/upgrade/success` 页面通过轮询 `/api/user/me` 获取状态更新，但存在以下问题：

**攻击场景**:
1. 用户完成支付后立即被重定向到 `/upgrade/success`
2. 此时 Webhook 尚未到达或尚未处理完成
3. 前端开始轮询，但在 Webhook 处理完成前可能显示 "升级失败" 或 "处理中"
4. 如果轮询超时设置不合理，可能导致用户误以为支付失败
5. 用户可能重复发起支付请求

**漏洞根源**:
- 缺少明确的 "处理中" 状态
- 轮询超时时间不明确
- 缺少对 Webhook 延迟的容错处理

**影响范围**:
- 用户体验问题
- 可能导致重复支付
- 客服工作量增加

**CVSS 评分**: 4.3 (Medium)

**缓解建议**:
```typescript
// 方案 1: 添加中间状态
// 在创建 checkout 时记录状态
await supabase.from('payment_sessions').insert({
  user_id: user.id,
  session_id: creemSessionId,
  status: 'pending' // pending | completed | failed
});

// Webhook 中更新状态
await supabase
  .from('payment_sessions')
  .update({ status: 'completed' })
  .eq('session_id', event.checkout_session_id);

// 前端轮询时检查 payment_sessions 表
const { data } = await supabase
  .from('payment_sessions')
  .select('status')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

// 方案 2: 设置合理的轮询策略
const pollWithBackoff = async () => {
  let attempts = 0;
  const maxAttempts = 30; // 最多轮询 30 次
  const initialInterval = 1000; // 初始 1 秒

  while (attempts < maxAttempts) {
    const response = await fetch('/api/user/me');
    const data = await response.json();

    if (data.plan === 'pro') {
      return 'success';
    }

    // 指数退避
    const delay = Math.min(initialInterval * Math.pow(1.5, attempts), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempts++;
  }

  return 'timeout';
};

// 方案 3: 使用 Supabase Realtime
// 订阅 profiles 表的变化
const channel = supabase
  .channel('profile-changes')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
    filter: `id=eq.${userId}`
  }, (payload) => {
    if (payload.new.plan === 'pro') {
      setUpgradeComplete(true);
    }
  })
  .subscribe();
```

---

### ⚠️ 3.4 缺少 Webhook 来源 IP 白名单验证（中风险）

**风险描述**:
虽然有签名验证，但如果 `CREEM_WEBHOOK_SECRET` 泄露，攻击者可以从任意 IP 发送伪造的 Webhook 请求。

**攻击场景**:
1. 密钥通过环境变量泄露（如 Git 提交、日志文件）
2. 攻击者获取密钥后，可以伪造签名
3. 从任意 IP 发送 Webhook 请求升级任意账户

**缓解建议**:
```typescript
// /api/creem/webhook/route.ts
const ALLOWED_IPS = [
  '54.187.174.169',
  '54.187.205.235',
  // Creem 官方 IP 地址
];

const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ||
                 request.headers.get('x-real-ip');

if (!ALLOWED_IPS.includes(clientIp)) {
  console.warn(`Webhook from unauthorized IP: ${clientIp}`);
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

---

### ⚠️ 3.5 错误信息泄露（低风险）

**风险描述**:
API 错误响应可能包含敏感信息，帮助攻击者了解系统内部结构。

**问题示例**:
```typescript
// ❌ 不安全的错误处理
catch (error) {
  return NextResponse.json({
    error: error.message, // 可能包含 SQL 错误、文件路径等
    stack: error.stack     // 泄露代码结构
  }, { status: 500 });
}
```

**缓解建议**:
```typescript
// ✅ 安全的错误处理
catch (error) {
  console.error('Webhook processing error:', error); // 仅记录到服务端日志

  return NextResponse.json({
    error: 'Internal server error'
  }, { status: 500 });
}

// 对于调试需求，使用专门的错误跟踪服务（如 Sentry）
Sentry.captureException(error, {
  tags: {
    endpoint: '/api/creem/webhook',
    event_id: event.id
  }
});
```

---

### ⚠️ 3.6 缺少支付金额验证（中风险）

**风险描述**:
Webhook 只检查 `event.type` 和 `metadata.userId`，但未验证支付金额是否正确。

**攻击场景**:
1. 攻击者创建一个金额为 $0.01 的 Checkout Session
2. 完成支付后，Webhook 仍会将账户升级为 Pro
3. 导致业务损失

**缓解建议**:
```typescript
// Webhook 中验证金额
if (event.type === 'checkout.session.completed') {
  const expectedAmount = 2999; // $29.99 的最小单位表示

  if (event.amount_total !== expectedAmount) {
    console.error('Invalid payment amount:', event.amount_total);
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  // 继续处理升级逻辑
}
```

---

### ⚠️ 3.7 CSRF 防护不足（低风险）

**风险描述**:
虽然 `/api/checkout` 需要身份验证，但如果使用 Cookie-based Session，可能受到 CSRF 攻击。

**攻击场景**:
1. 用户登录后访问恶意网站
2. 恶意网站通过 `<form>` 或 `fetch` 自动向 `/api/checkout` 发送请求
3. 如果 Cookie 自动携带，可能创建非用户意愿的支付请求

**缓解建议**:
```typescript
// 方案 1: 使用 SameSite Cookie
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Set-Cookie',
            value: 'SameSite=Lax; Secure; HttpOnly'
          }
        ]
      }
    ];
  }
};

// 方案 2: 添加 CSRF Token
// 前端请求时携带 token
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

await fetch('/api/checkout', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': csrfToken
  }
});

// 服务端验证
const requestToken = request.headers.get('x-csrf-token');
const sessionToken = await getCsrfTokenFromSession();

if (requestToken !== sessionToken) {
  return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
}
```

---

## 4. 安全改进建议

### 🔒 4.1 实施 metadata 完整性保护（优先级：高）

**实施方案**:
```typescript
// lib/checkout-utils.ts
import { createHmac } from 'crypto';

export function createSecureMetadata(userId: string) {
  const timestamp = Date.now();
  const data = `${userId}:${timestamp}`;
  const signature = createHmac('sha256', process.env.METADATA_SECRET!)
    .update(data)
    .digest('hex');

  return {
    userId,
    timestamp,
    sig: signature.substring(0, 16)
  };
}

export function verifyMetadata(metadata: any): boolean {
  const { userId, timestamp, sig } = metadata;

  // 检查时间戳（防止旧的 metadata 被重用）
  if (Date.now() - timestamp > 3600000) { // 1 小时过期
    return false;
  }

  const data = `${userId}:${timestamp}`;
  const expectedSig = createHmac('sha256', process.env.METADATA_SECRET!)
    .update(data)
    .digest('hex')
    .substring(0, 16);

  return sig === expectedSig;
}

// /api/checkout/route.ts
const metadata = createSecureMetadata(user.id);
const checkoutSession = await createCreemCheckout({ metadata });

// /api/creem/webhook/route.ts
if (!verifyMetadata(event.metadata)) {
  throw new Error('Invalid metadata signature');
}
```

**预期效果**: 防止 metadata 被篡改，确保支付与正确的用户关联

---

### 🔒 4.2 实施分布式锁防止并发问题（优先级：高）

**实施方案**:
```typescript
// lib/redis-lock.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export async function acquireLock(
  key: string,
  ttl: number = 10
): Promise<boolean> {
  const result = await redis.set(
    `lock:${key}`,
    '1',
    'EX',
    ttl,
    'NX'
  );
  return result === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await redis.del(`lock:${key}`);
}

// /api/creem/webhook/route.ts
const lockKey = `webhook:${event.id}`;
const acquired = await acquireLock(lockKey, 30);

if (!acquired) {
  return NextResponse.json({ received: true }, { status: 200 });
}

try {
  await processWebhook(event);
} finally {
  await releaseLock(lockKey);
}
```

**预期效果**: 消除竞态条件，确保 Webhook 处理的原子性

---

### 🔒 4.3 添加支付会话映射表（优先级：高）

**实施方案**:
```sql
-- 创建支付会话表
CREATE TABLE payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  creem_session_id TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed | expired
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX idx_payment_sessions_user_id ON payment_sessions(user_id);
CREATE INDEX idx_payment_sessions_status ON payment_sessions(status);
```

```typescript
// /api/checkout/route.ts
const checkoutSession = await createCreemCheckout({...});

// 记录会话
await supabase.from('payment_sessions').insert({
  user_id: user.id,
  creem_session_id: checkoutSession.id,
  amount: 2999,
  status: 'pending',
  metadata: { /* ... */ }
});

// /api/creem/webhook/route.ts
const { data: session } = await supabase
  .from('payment_sessions')
  .select('*')
  .eq('creem_session_id', event.checkout_session_id)
  .single();

// 验证会话
if (!session) throw new Error('Session not found');
if (session.status === 'completed') {
  return NextResponse.json({ received: true }, { status: 200 });
}
if (session.user_id !== event.metadata.userId) {
  throw new Error('User ID mismatch');
}
if (event.amount_total !== session.amount) {
  throw new Error('Amount mismatch');
}

// 更新会话状态
await supabase
  .from('payment_sessions')
  .update({ status: 'completed', updated_at: new Date() })
  .eq('id', session.id);
```

**预期效果**:
- 双重验证用户身份
- 验证支付金额
- 提供可审计的支付历史

---

### 🔒 4.4 实施 Webhook IP 白名单（优先级：中）

**实施方案**:
```typescript
// lib/webhook-security.ts
const CREEM_WEBHOOK_IPS = [
  '54.187.174.169',
  '54.187.205.235',
  // 从 Creem 文档获取最新 IP 列表
];

export function validateWebhookSource(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  const clientIp = forwarded?.split(',')[0].trim() || realIp;

  if (!clientIp || !CREEM_WEBHOOK_IPS.includes(clientIp)) {
    console.warn(`Webhook from unauthorized IP: ${clientIp}`);
    return false;
  }

  return true;
}

// /api/creem/webhook/route.ts
if (!validateWebhookSource(request)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**预期效果**: 额外的防御层，即使密钥泄露也能阻止大部分攻击

---

### 🔒 4.5 优化轮询策略（优先级：中）

**实施方案**:
```typescript
// components/upgrade-success.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';

export function UpgradeSuccessPage() {
  const { user, isPro, refreshAuth } = useAuth();
  const [status, setStatus] = useState<'pending' | 'completed' | 'timeout'>('pending');

  useEffect(() => {
    if (!user) return;

    // 方案 1: 使用 Supabase Realtime
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`profile:${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`
      }, (payload) => {
        if (payload.new.plan === 'pro') {
          setStatus('completed');
          refreshAuth();
        }
      })
      .subscribe();

    // 方案 2: 轮询降级（Realtime 失败时使用）
    const timeoutId = setTimeout(() => {
      if (status === 'pending') {
        pollWithBackoff();
      }
    }, 5000);

    return () => {
      channel.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [user]);

  const pollWithBackoff = async () => {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts && status === 'pending') {
      await refreshAuth();

      if (isPro) {
        setStatus('completed');
        return;
      }

      const delay = Math.min(1000 * Math.pow(1.3, attempts), 10000);
      await new Promise(r => setTimeout(r, delay));
      attempts++;
    }

    setStatus('timeout');
  };

  return (
    <div>
      {status === 'pending' && <p>正在处理您的支付...</p>}
      {status === 'completed' && <p>升级成功！</p>}
      {status === 'timeout' && (
        <p>处理时间较长，请稍后刷新页面或联系客服</p>
      )}
    </div>
  );
}
```

**预期效果**:
- 降低服务器负载
- 改善用户体验
- 减少竞态条件风险

---

### 🔒 4.6 实施全面的审计日志（优先级：中）

**实施方案**:
```sql
-- 创建审计日志表
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

```typescript
// lib/audit.ts
export async function logAudit(params: {
  userId?: string;
  action: string;
  resource: string;
  details?: any;
  request?: Request;
}) {
  const { userId, action, resource, details, request } = params;

  await supabase.from('audit_logs').insert({
    user_id: userId,
    action,
    resource,
    details,
    ip_address: request?.headers.get('x-forwarded-for')?.split(',')[0],
    user_agent: request?.headers.get('user-agent')
  });
}

// /api/checkout/route.ts
await logAudit({
  userId: user.id,
  action: 'checkout.created',
  resource: 'payment',
  details: { sessionId: checkoutSession.id },
  request
});

// /api/creem/webhook/route.ts
await logAudit({
  userId: event.metadata.userId,
  action: 'webhook.received',
  resource: 'payment',
  details: { eventId: event.id, type: event.type },
  request
});

await logAudit({
  userId: event.metadata.userId,
  action: 'plan.upgraded',
  resource: 'profile',
  details: { from: 'free', to: 'pro' },
  request
});
```

**预期效果**:
- 提供完整的审计追踪
- 便于安全事件调查
- 满足合规要求

---

### 🔒 4.7 添加速率限制（优先级：中）

**实施方案**:
```typescript
// lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!
});

// Checkout API: 每用户每小时 5 次
export const checkoutRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  analytics: true
});

// Webhook: 全局每分钟 100 次
export const webhookRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'),
  analytics: true
});

// /api/checkout/route.ts
const { success } = await checkoutRateLimit.limit(user.id);
if (!success) {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429 }
  );
}

// /api/creem/webhook/route.ts
const { success } = await webhookRateLimit.limit('global');
if (!success) {
  return NextResponse.json(
    { error: 'Rate limit exceeded' },
    { status: 429 }
  );
}
```

**预期效果**:
- 防止暴力攻击
- 保护服务器资源
- 检测异常行为

---

### 🔒 4.8 实施 Content Security Policy (CSP)（优先级：低）

**实施方案**:
```typescript
// next.config.js
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.creem.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self' https://checkout.creem.com;
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;

module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader.replace(/\n/g, '')
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ];
  }
};
```

**预期效果**: 防止 XSS、点击劫持等前端攻击

---

## 5. 风险矩阵

| 风险项 | 严重性 | 可能性 | 风险等级 | 优先级 |
|--------|--------|--------|----------|--------|
| metadata.userId 篡改 | 高 | 中 | 高 | P0 |
| Webhook 重放攻击 | 中 | 低 | 中 | P1 |
| 支付金额验证缺失 | 高 | 低 | 中 | P1 |
| 竞态条件 | 中 | 中 | 中 | P1 |
| IP 白名单缺失 | 中 | 低 | 低 | P2 |
| CSRF 攻击 | 中 | 低 | 低 | P2 |
| 错误信息泄露 | 低 | 高 | 低 | P2 |
| 缺少审计日志 | 低 | N/A | 低 | P3 |

---

## 6. 合规性检查

### GDPR (通用数据保护条例)
- ✅ 用户同意：支付前需用户明确操作
- ⚠️ 数据最小化：`payment_sessions` 表应定期清理过期记录
- ✅ 数据可移植性：用户可导出支付历史
- ⚠️ 隐私政策：需明确说明支付数据处理方式

### PCI DSS (支付卡行业数据安全标准)
- ✅ 不存储卡号信息（由 Creem 处理）
- ✅ 使用 HTTPS 加密传输
- ⚠️ 需定期安全审计
- ⚠️ Webhook 日志不应包含敏感支付信息

### SOC 2
- ⚠️ 需实施完整的审计日志
- ⚠️ 需定期备份 `webhook_events` 和 `payment_sessions` 表
- ⚠️ 需实施访问控制策略

---

## 7. 监控与告警建议

### 关键指标监控
```typescript
// 建议监控的指标
const metrics = {
  // 业务指标
  'checkout.created': 'counter',
  'checkout.completed': 'counter',
  'checkout.failed': 'counter',
  'webhook.received': 'counter',
  'webhook.processed': 'counter',
  'webhook.failed': 'counter',

  // 安全指标
  'webhook.signature_invalid': 'counter',
  'webhook.duplicate': 'counter',
  'checkout.rate_limited': 'counter',
  'metadata.verification_failed': 'counter',

  // 性能指标
  'webhook.processing_time': 'histogram',
  'checkout.response_time': 'histogram'
};
```

### 告警规则
```yaml
# 告警配置示例
alerts:
  - name: HighWebhookFailureRate
    condition: webhook.failed / webhook.received > 0.1
    severity: critical
    message: "Webhook 失败率超过 10%"

  - name: SignatureValidationFailures
    condition: webhook.signature_invalid > 5 in 5m
    severity: high
    message: "检测到多次签名验证失败，可能存在攻击"

  - name: MetadataVerificationFailures
    condition: metadata.verification_failed > 3 in 10m
    severity: high
    message: "metadata 验证失败，可能存在篡改攻击"

  - name: SlowWebhookProcessing
    condition: p95(webhook.processing_time) > 5000ms
    severity: medium
    message: "Webhook 处理时间过长"
```

---

## 8. 测试建议

### 安全测试用例
```typescript
// 测试套件示例
describe('Payment Security Tests', () => {

  test('应阻止未认证用户创建 checkout', async () => {
    const response = await fetch('/api/checkout', {
      method: 'POST'
    });
    expect(response.status).toBe(401);
  });

  test('应阻止已付费用户重复升级', async () => {
    const proUser = await createProUser();
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${proUser.token}` }
    });
    expect(response.status).toBe(400);
  });

  test('应拒绝无效签名的 Webhook', async () => {
    const response = await fetch('/api/creem/webhook', {
      method: 'POST',
      headers: { 'x-creem-signature': 'invalid' },
      body: JSON.stringify({ type: 'checkout.completed' })
    });
    expect(response.status).toBe(401);
  });

  test('应处理重复的 Webhook 事件', async () => {
    const event = createMockWebhookEvent();

    // 第一次请求
    const res1 = await sendWebhook(event);
    expect(res1.status).toBe(200);

    // 第二次请求（重复）
    const res2 = await sendWebhook(event);
    expect(res2.status).toBe(200);

    // 验证用户只被升级一次
    const profile = await getProfile(event.metadata.userId);
    expect(profile.plan).toBe('pro');
  });

  test('应拒绝被篡改的 metadata', async () => {
    const event = createMockWebhookEvent({
      metadata: {
        userId: 'attacker-id',
        timestamp: Date.now(),
        sig: 'invalid'
      }
    });

    const response = await sendWebhook(event);
    expect(response.status).toBe(400);
  });

  test('应验证支付金额', async () => {
    const event = createMockWebhookEvent({
      amount_total: 1 // 错误的金额
    });

    const response = await sendWebhook(event);
    expect(response.status).toBe(400);
  });

  test('应在超时后停止轮询', async () => {
    const { pollStatus } = renderUpgradeSuccessPage();

    await waitFor(() => {
      expect(pollStatus).toBe('timeout');
    }, { timeout: 65000 }); // 等待超时
  });
});
```

### 渗透测试清单
- [ ] 尝试伪造 JWT Token
- [ ] 尝试篡改 Checkout Session metadata
- [ ] 尝试重放 Webhook 请求
- [ ] 尝试从非白名单 IP 发送 Webhook
- [ ] 尝试 SQL 注入攻击
- [ ] 尝试 XSS 攻击
- [ ] 尝试绕过速率限制
- [ ] 尝试 CSRF 攻击
- [ ] 压力测试并发 Webhook 请求

---

## 9. 总结与建议

### 当前安全态势
- ✅ **认证机制**: 基于 Supabase Auth 的 JWT，安全性较高
- ✅ **双重护栏**: 前端和服务端都进行了权限检查
- ✅ **Webhook 验签**: 实施了基本的签名验证
- ✅ **幂等性设计**: 使用 Insert-First 模式防止重复处理
- ⚠️ **数据完整性**: metadata.userId 的验证不足
- ⚠️ **并发控制**: 缺少分布式锁机制
- ⚠️ **审计能力**: 缺少完整的审计日志

### 必须实施的改进（P0）
1. **metadata 完整性保护**: 添加 HMAC 签名或使用数据库映射表
2. **支付金额验证**: 在 Webhook 中验证支付金额是否匹配

### 强烈推荐的改进（P1）
3. **分布式锁**: 使用 Redis 或数据库事务防止竞态条件
4. **支付会话映射表**: 提供可审计的支付历史
5. **IP 白名单**: 限制 Webhook 的来源 IP

### 建议实施的改进（P2）
6. **速率限制**: 防止滥用和 DDoS 攻击
7. **审计日志**: 记录所有关键操作
8. **优化轮询策略**: 使用 Realtime 订阅减少服务器负载
9. **错误处理**: 避免敏感信息泄露

### 长期改进（P3）
10. **CSP 策略**: 增强前端安全
11. **合规性审计**: 确保符合 GDPR、PCI DSS 等标准
12. **定期渗透测试**: 由第三方安全公司进行评估

---

## 10. 参考资源

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Stripe Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)
- [Supabase Security](https://supabase.com/docs/guides/platform/security)
- [Next.js Security Headers](https://nextjs.org/docs/advanced-features/security-headers)
- [PCI DSS Compliance](https://www.pcisecuritystandards.org/)

---

**文档版本**: 1.0
**最后更新**: 2025-11-12
**作者**: 资深安全工程师
**状态**: 待审核
