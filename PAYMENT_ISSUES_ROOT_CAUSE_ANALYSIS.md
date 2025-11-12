# Creem 支付完成后的 4 个核心问题 - 根因分析与完整解决方案

**分析日期**: 2025-11-12
**分析深度**: 根因分析 + 代码级解决方案
**目标**: 一次性解决所有支付后的用户体验问题

---

## 📋 问题概览

| # | 问题描述 | 严重程度 | 影响面 | 优先级 |
|---|---------|---------|--------|--------|
| 1 | **付费后，高级功能没开放** | 🔴 严重 | 所有付费用户 | P0 |
| 2 | **付费后再次点击付费，应进入 Manage，而不是 Creem 报错** | 🟠 中等 | 已付费用户 | P1 |
| 3 | **付费之前需判断登录，否则弹登录** | 🟡 一般 | 未登录用户 | P1 |
| 4 | **付费成功后，导航右上角 Upgrade 消失** | 🔴 严重 | 所有付费用户 | P0 |

---

# 问题 1️⃣: 付费后，高级功能没开放

## 🔍 根因分析

基于架构文档，这个问题有 **5 个可能的根因**，需要逐层排查：

### 根因 1.1: Webhook 未成功触发或处理失败

**症状**:
```sql
-- 查询 webhook_events 表
SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 5;
-- 如果为空或 processing_status = 'failed'，说明 Webhook 有问题
```

**可能原因**:
1. Creem Dashboard 未配置 Webhook URL
2. Webhook Secret 配置错误（Test Mode vs Live Mode）
3. 验签失败导致 401 返回
4. 服务器防火墙拦截
5. 数据库写入失败（RLS 策略、权限问题）

**诊断步骤**:
```bash
# 1. 检查 Creem Dashboard
登录 https://dashboard.creem.io
→ Settings → Webhooks
→ 确认 Endpoint Status 为 Active
→ 查看 Recent deliveries 是否有 200 响应

# 2. 检查环境变量
echo $CREEM_WEBHOOK_SECRET
# 应该是 whsec_test_xxx (Test Mode) 或 whsec_xxx (Live Mode)

# 3. 查看服务器日志
# Vercel: vercel.com/dashboard → Logs
# 搜索 "WEBHOOK REQUEST RECEIVED"
```

---

### 根因 1.2: profiles.plan 字段未更新或不存在

**症状**:
```sql
SELECT id, email, plan, plan_updated_at
FROM profiles
WHERE email = 'user@example.com';

-- 如果 plan = 'free' 且 plan_updated_at 为 NULL，说明未更新
-- 如果报错 "column plan does not exist"，说明字段缺失
```

**可能原因**:
1. `profiles` 表缺少 `plan` 字段
2. Webhook 更新时使用了错误的 `userId`
3. 用户记录在 `profiles` 表中不存在
4. RLS 策略阻止了更新

**修复方案**:
```sql
-- 1. 添加缺失的字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- 2. 添加约束
ALTER TABLE profiles ADD CONSTRAINT check_plan_value
  CHECK (plan IN ('anonymous', 'free', 'pro'));

-- 3. 检查 RLS 策略
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles';

-- 4. 如果需要，临时禁用 RLS 测试
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
-- 测试完后记得重新启用！
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 5. 或添加允许 Service Role 更新的策略
CREATE POLICY "service_role_update_plan" ON profiles
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
```

---

### 根因 1.3: metadata.userId 丢失或不匹配

**症状**:
```sql
-- 查询 webhook_events 中的 userId
SELECT
  event_id,
  user_id,
  payload->'data'->'metadata'->>'userId' as metadata_user_id,
  processing_status
FROM webhook_events
ORDER BY received_at DESC
LIMIT 5;

-- 如果 user_id 为 NULL，说明 metadata 中没有 userId
```

**可能原因**:
1. 创建 Checkout 时未传递 `metadata: { userId }`
2. Creem 的 metadata 结构变化
3. Webhook 处理代码提取 userId 的路径错误

**修复方案**:
```typescript
// ✅ 修复 /api/checkout/route.ts
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 创建 Creem Checkout
  const checkout = await fetch('https://api.creem.io/v1/checkout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CREEM_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      line_items: [{ price: 'price_xxx', quantity: 1 }],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_URL}/upgrade/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/upgrade`,

      // 🔥 关键：确保传递 userId
      metadata: {
        userId: user.id,  // ← 必须传递
        email: user.email
      }
    })
  }).then(res => res.json());

  return Response.json({ url: checkout.url });
}
```

```typescript
// ✅ 修复 Webhook 处理中的 userId 提取
// app/api/creem/webhook/route.ts
export async function POST(req: Request) {
  const body = await req.text();
  const event = JSON.parse(body);

  // 🔥 兼容多种 metadata 位置
  const userId =
    event.data?.metadata?.userId ||           // Creem 标准位置
    event.data?.object?.metadata?.userId ||   // 嵌套位置
    event.metadata?.userId;                   // 顶层位置

  if (!userId) {
    console.error('❌ Missing userId in event:', JSON.stringify(event, null, 2));

    // 🔥 记录错误事件以便调试
    await supabase.from('webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
      processing_status: 'failed',
      error_message: 'Missing userId in metadata'
    });

    return Response.json({ error: 'Missing userId' }, { status: 400 });
  }

  // 继续处理...
}
```

---

### 根因 1.4: 前端轮询未正确获取状态

**症状**:
- 用户在 `/upgrade/success` 页面停留很久
- 控制台无报错，但一直显示 "Processing..."
- 数据库中 `plan = 'pro'` 已更新，但前端未检测到

**可能原因**:
1. `/api/user/me` 接口返回的是旧数据（缓存）
2. 轮询逻辑有 bug（未正确解析响应）
3. 轮询次数超限后放弃
4. `isUserPro()` 函数判断逻辑错误

**修复方案**:
```typescript
// ✅ 修复 /api/user/me/route.ts
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 🔥 强制从数据库获取最新数据（不使用缓存）
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan, plan_updated_at')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Failed to fetch profile:', profileError);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }

  // 🔥 确保返回的数据结构一致
  return NextResponse.json({
    id: user.id,
    email: user.email,
    plan: profile?.plan || 'free',  // 默认值
    isPro: profile?.plan === 'pro',  // 明确的 boolean
    planUpdatedAt: profile?.plan_updated_at
  }, {
    // 🔥 防止缓存
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}
```

```typescript
// ✅ 修复前端轮询逻辑
// app/upgrade/success/page.tsx
'use client';

import { useEffect, useState } from 'next';
import { useRouter } from 'next/navigation';

export default function SuccessPage() {
  const [status, setStatus] = useState<'processing' | 'ready' | 'timeout'>('processing');
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 30;  // 最多 30 次
    let pollInterval = 1000;  // 初始 1 秒

    const pollStatus = async () => {
      try {
        console.log(`[Poll #${attempts + 1}] Checking payment status...`);

        const response = await fetch('/api/user/me', {
          cache: 'no-store',  // 🔥 强制不使用缓存
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });

        if (!response.ok) {
          console.error('Failed to fetch user:', response.status);
          throw new Error('Failed to fetch user');
        }

        const data = await response.json();
        console.log('[Poll] Received:', data);

        // 🔥 明确检查 isPro 字段
        if (data.isPro === true || data.plan === 'pro') {
          console.log('✅ User is now Pro! Redirecting...');
          setStatus('ready');

          // 🔥 先刷新 RSC，等待一下再跳转
          await router.refresh();
          await new Promise(resolve => setTimeout(resolve, 500));
          router.replace('/');  // 使用 replace 避免回退
          return;
        }

        attempts++;

        // 🔥 超时处理
        if (attempts >= maxAttempts) {
          console.error('❌ Timeout: Payment status not updated after', maxAttempts, 'attempts');
          setStatus('timeout');
          return;
        }

        // 🔥 指数退避：1s → 2s → 4s → 最大 10s
        pollInterval = Math.min(pollInterval * 1.5, 10000);
        setTimeout(pollStatus, pollInterval);

      } catch (error) {
        console.error('[Poll] Error:', error);
        attempts++;

        if (attempts < maxAttempts) {
          setTimeout(pollStatus, pollInterval);
        } else {
          setStatus('timeout');
        }
      }
    };

    // 立即开始轮询
    pollStatus();

    // Cleanup
    return () => {
      attempts = maxAttempts;  // 停止轮询
    };
  }, [router]);

  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-lg">Processing your payment...</p>
        <p className="mt-2 text-sm text-gray-500">This usually takes 1-5 seconds</p>
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-yellow-600 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold mb-2">Payment Processing Timeout</h1>
        <p className="text-gray-600 mb-4">
          Your payment is still being processed. Please check back in a few minutes.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Return to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-green-600 text-5xl mb-4">✅</div>
      <h1 className="text-2xl font-bold">Payment Successful!</h1>
      <p className="text-gray-600">Redirecting to home...</p>
    </div>
  );
}
```

---

### 根因 1.5: isUserPro() 判断逻辑错误

**症状**:
- 数据库 `plan = 'pro'` 已正确
- `/api/user/me` 返回 `plan: 'pro'`
- 但高级功能仍然被拒绝

**可能原因**:
1. `isUserPro()` 函数逻辑错误
2. 功能权限检查使用了不同的数据源
3. 缓存问题（客户端状态未刷新）

**修复方案**:
```typescript
// ✅ 修复 lib/supabase/admin.ts 或 lib/auth.ts
export interface ProfileLite {
  plan?: string;
  subscription_status?: string;
  pro_until?: string;
}

export function isUserPro(profile: ProfileLite | null): boolean {
  if (!profile) return false;

  // 🔥 简化逻辑：只看 plan 字段
  // 因为根据数据库分析，只有 plan 字段实际存在
  return profile.plan === 'pro';

  // ❌ 旧逻辑（有问题）:
  // const byPlan = profile.plan === 'pro';
  // const bySub = profile.subscription_status === 'active';  // subscription_status 字段不存在！
  // const byGift = profile.pro_until ? new Date(profile.pro_until).getTime() > Date.now() : false;
  // return Boolean(byPlan || bySub || byGift);
}
```

```typescript
// ✅ 在功能权限检查中统一使用
// app/api/summary/route.ts (示例高级功能)
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 🔥 从数据库获取最新状态
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  // 🔥 统一使用 isUserPro 检查
  if (!isUserPro(profile)) {
    return Response.json(
      { error: 'This feature requires Pro subscription' },
      { status: 403 }
    );
  }

  // 执行高级功能...
}
```

---

## ✅ 完整解决方案（问题 1）

### 步骤 1: 数据库检查与修复
```sql
-- 1. 确保 profiles 表有必要字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- 2. 创建 webhook_events 表（如果不存在）
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  event_object TEXT,
  payload JSONB NOT NULL,
  processing_status TEXT DEFAULT 'pending',
  user_id UUID REFERENCES profiles(id),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(processing_status);

-- 3. 检查并修复 RLS 策略
CREATE POLICY "service_role_full_access" ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### 步骤 2: 修复 Webhook 处理
```typescript
// app/api/creem/webhook/route.ts
// [使用上面"根因 1.3"中提供的完整代码]
```

### 步骤 3: 修复前端轮询
```typescript
// app/upgrade/success/page.tsx
// [使用上面"根因 1.4"中提供的完整代码]
```

### 步骤 4: 统一权限检查
```typescript
// 在所有高级功能的 API 中使用统一的检查逻辑
// [使用上面"根因 1.5"中提供的代码]
```

---

# 问题 2️⃣: 付费后再次点击付费，应进入 Manage，而不是 Creem 报错

## 🔍 根因分析

### 根因 2.1: /api/checkout 未检查用户是否已是 Pro

**症状**:
- Pro 用户点击 "Upgrade" 按钮
- 跳转到 Creem 支付页面
- Creem 返回错误：`Customer already has an active subscription`

**问题代码**:
```typescript
// ❌ 错误的实现
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 直接创建 Checkout，没有检查
  const checkout = await createCreemCheckout(user.id);
  return Response.json({ url: checkout.url });
}
```

**修复方案**:
```typescript
// ✅ 正确的实现
// app/api/checkout/route.ts
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isUserPro } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();

  // 1️⃣ 验证身份
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2️⃣ 检查用户是否已是 Pro
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  if (isUserPro(profile)) {
    // 🔥 如果已经是 Pro，返回管理链接
    return NextResponse.json({
      error: 'Already subscribed',
      message: 'You already have an active Pro subscription',
      manageUrl: '/account'  // 或 Creem 的 Customer Portal URL
    }, { status: 400 });
  }

  // 3️⃣ 创建 Checkout
  const checkout = await fetch('https://api.creem.io/v1/checkout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CREEM_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      line_items: [{ price: process.env.CREEM_PRICE_ID, quantity: 1 }],
      mode: 'subscription',  // 或 'payment'
      success_url: `${process.env.NEXT_PUBLIC_URL}/upgrade/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/upgrade`,
      metadata: {
        userId: user.id,
        email: user.email
      }
    })
  }).then(res => res.json());

  if (!checkout.url) {
    console.error('Failed to create checkout:', checkout);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: checkout.url });
}
```

---

### 根因 2.2: 前端未根据 Pro 状态显示不同按钮

**症状**:
- Pro 用户在页面上仍然看到 "Upgrade to Pro" 按钮
- 点击后触发上述错误

**问题代码**:
```typescript
// ❌ 错误的实现
export default function UpgradeButton() {
  return (
    <button onClick={() => {
      fetch('/api/checkout', { method: 'POST' })
        .then(res => res.json())
        .then(data => window.location.href = data.url);
    }}>
      Upgrade to Pro
    </button>
  );
}
```

**修复方案**:
```typescript
// ✅ 正确的实现 - 前端检查
// components/nav/UpgradeEntry.tsx
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isUserPro } from '@/lib/auth';
import Link from 'next/link';

export default async function UpgradeEntry() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Link href="/login" className="btn btn-primary">
        Sign In
      </Link>
    );
  }

  // 🔥 获取用户状态
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const isPro = isUserPro(profile);

  // 🔥 根据状态显示不同的按钮
  if (isPro) {
    return (
      <Link href="/account" className="btn btn-secondary">
        Manage Subscription
      </Link>
    );
  }

  return (
    <Link href="/upgrade" className="btn btn-primary">
      Upgrade to Pro
    </Link>
  );
}
```

```typescript
// ✅ 正确的实现 - 客户端组件处理点击
// app/upgrade/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UpgradePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleUpgrade = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        // 🔥 处理"已经是 Pro"的情况
        if (data.manageUrl) {
          router.push(data.manageUrl);
          return;
        }

        throw new Error(data.message || 'Failed to create checkout');
      }

      // 跳转到 Creem 支付页面
      window.location.href = data.url;

    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">Upgrade to Pro</h1>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handleUpgrade}
        disabled={isLoading}
        className="btn btn-primary"
      >
        {isLoading ? 'Processing...' : 'Upgrade Now'}
      </button>
    </div>
  );
}
```

---

### 根因 2.3: 应该提供 Creem Customer Portal 链接

**更优方案**: 使用 Creem 的 Customer Portal 让用户管理订阅

```typescript
// ✅ 创建 Customer Portal Session
// app/api/customer-portal/route.ts
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 🔥 调用 Creem API 创建 Customer Portal Session
  const session = await fetch('https://api.creem.io/v1/customer-portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CREEM_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customer: user.email,  // 或 Creem Customer ID
      return_url: `${process.env.NEXT_PUBLIC_URL}/account`
    })
  }).then(res => res.json());

  if (!session.url) {
    console.error('Failed to create portal session:', session);
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: session.url });
}
```

```typescript
// ✅ 在前端使用
// components/nav/UpgradeEntry.tsx
export default async function UpgradeEntry() {
  // ... 前面的代码 ...

  if (isPro) {
    return (
      <form action="/api/customer-portal" method="POST">
        <button type="submit" className="btn btn-secondary">
          Manage Subscription
        </button>
      </form>
    );
  }

  // ... 后面的代码 ...
}
```

---

## ✅ 完整解决方案（问题 2）

### 实施步骤:

1. **修复 `/api/checkout` 接口** - 添加 Pro 状态检查
2. **修复 `UpgradeEntry` 组件** - 根据状态显示不同按钮
3. **创建 `/api/customer-portal` 接口** - 提供订阅管理入口
4. **前端错误处理** - 优雅处理"已订阅"的情况

---

# 问题 3️⃣: 付费之前需判断登录，否则弹登录

## 🔍 根因分析

### 根因 3.1: 前端未检查登录状态

**症状**:
- 未登录用户点击 "Upgrade" 按钮
- 跳转到 `/api/checkout`
- 返回 401 错误
- 用户看到错误提示，而不是登录页面

**修复方案**:
```typescript
// ✅ 在 Upgrade 页面添加登录检查
// app/upgrade/page.tsx
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import UpgradeContent from './UpgradeContent';

export default async function UpgradePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 🔥 未登录，重定向到登录页
  if (!user) {
    redirect('/login?redirect=/upgrade');  // 登录后返回升级页
  }

  // 🔥 检查是否已是 Pro
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  if (profile?.plan === 'pro') {
    redirect('/account');  // 已是 Pro，重定向到账户页
  }

  return <UpgradeContent />;
}
```

```typescript
// ✅ 客户端组件 - 添加登录检查
// app/upgrade/UpgradeContent.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UpgradeContent() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleUpgrade = async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST'
      });

      if (response.status === 401) {
        // 🔥 未登录，重定向到登录页
        router.push('/login?redirect=/upgrade');
        return;
      }

      const data = await response.json();

      if (data.manageUrl) {
        router.push(data.manageUrl);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }

    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleUpgrade} disabled={isLoading}>
        {isLoading ? 'Processing...' : 'Upgrade to Pro'}
      </button>
    </div>
  );
}
```

---

### 根因 3.2: 导航栏未根据登录状态显示

**修复方案**:
```typescript
// ✅ 在导航栏组件中检查登录状态
// components/nav/UpgradeEntry.tsx (完整版本)
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isUserPro } from '@/lib/auth';
import Link from 'next/link';

export default async function UpgradeEntry() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 🔥 Case 1: 未登录
  if (!user) {
    return (
      <Link
        href="/login?redirect=/upgrade"
        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        <span>Sign In to Upgrade</span>
      </Link>
    );
  }

  // 🔥 Case 2: 已登录，获取 Pro 状态
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const isPro = isUserPro(profile);

  // 🔥 Case 3: 已是 Pro 用户
  if (isPro) {
    return (
      <Link
        href="/account"
        className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
      >
        <span>Manage</span>
      </Link>
    );
  }

  // 🔥 Case 4: 免费用户
  return (
    <Link
      href="/upgrade"
      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
    >
      <span>Upgrade</span>
    </Link>
  );
}
```

---

### 根因 3.3: 登录后应返回原页面

**修复方案**:
```typescript
// ✅ 登录页面处理 redirect 参数
// app/login/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (response.ok) {
        // 🔥 登录成功，返回原页面
        router.push(redirect);
      }

    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Sign In</h1>

      <form onSubmit={handleLogin}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="w-full px-4 py-2 border rounded mb-4"
          required
        />

        <button
          type="submit"
          disabled={isLoading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {redirect !== '/' && (
        <p className="mt-4 text-sm text-gray-600">
          After signing in, you'll be redirected to complete your upgrade.
        </p>
      )}
    </div>
  );
}
```

---

## ✅ 完整解决方案（问题 3）

### 实施步骤:

1. **修复 Upgrade 页面** - 添加服务端登录检查
2. **修复导航栏组件** - 根据登录状态显示不同按钮
3. **修复登录页面** - 处理 redirect 参数
4. **添加客户端保护** - 处理 401 错误并重定向

---

# 问题 4️⃣: 付费成功后，导航右上角 Upgrade 消失

## 🔍 根因分析

这个问题实际上是**预期行为**的描述，但我理解您的意思应该是：

**实际问题**: 付费成功后，导航右上角 Upgrade **应该** 消失（变成 Manage），但**没有消失**

### 根因 4.1: router.refresh() 未生效

**症状**:
- 付费完成，前端轮询检测到 `isPro = true`
- 调用 `router.refresh()` 和 `router.push('/')`
- 回到首页后，导航栏仍显示 "Upgrade" 按钮

**可能原因** (根据架构文档分析):
1. `router.refresh()` 和 `router.push('/')` 存在竞态条件
2. RSC 重新渲染未完成就跳转了
3. 浏览器缓存了旧的 HTML

**修复方案**:
```typescript
// ✅ 修复竞态条件
// app/upgrade/success/page.tsx
'use client';

import { useEffect, useState } from 'next';
import { useRouter } from 'next/navigation';

export default function SuccessPage() {
  const [status, setStatus] = useState<'processing' | 'ready'>('processing');
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 30;

    const pollStatus = async () => {
      try {
        const response = await fetch('/api/user/me', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        const data = await response.json();

        if (data.isPro === true) {
          console.log('✅ Payment confirmed, refreshing...');
          setStatus('ready');

          // 🔥 方案 1: 等待 refresh 完成
          await router.refresh();
          // 额外等待 500ms 确保 RSC 渲染完成
          await new Promise(resolve => setTimeout(resolve, 500));
          router.replace('/');  // 使用 replace 避免回退

          // 🔥 方案 2: 直接跳转首页（首页的 RSC 会自动获取最新状态）
          // router.replace('/');

          // 🔥 方案 3: 强制刷新整个页面（最保险但体验差）
          // window.location.href = '/';

          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(pollStatus, 1500);
        }

      } catch (error) {
        console.error('Poll error:', error);
        if (attempts < maxAttempts) {
          setTimeout(pollStatus, 1500);
        }
      }
    };

    pollStatus();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      {status === 'processing' ? (
        <>
          <div className="animate-spin h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Processing payment...</span>
        </>
      ) : (
        <>
          <div className="text-green-600 text-2xl">✅</div>
          <span className="ml-3">Payment successful! Redirecting...</span>
        </>
      )}
    </div>
  );
}
```

---

### 根因 4.2: UpgradeEntry 组件缓存问题

**症状**:
- `router.refresh()` 已调用
- 但 `UpgradeEntry` 组件未重新渲染

**可能原因**:
1. Next.js 的 RSC 缓存机制
2. 组件被 memoized
3. Supabase 查询被缓存

**修复方案**:
```typescript
// ✅ 强制不缓存
// components/nav/UpgradeEntry.tsx
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isUserPro } from '@/lib/auth';
import Link from 'next/link';

// 🔥 禁用 Next.js 缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function UpgradeEntry() {
  const supabase = createSupabaseServerClient();

  // 🔥 每次都重新获取用户信息（不使用缓存）
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Link href="/login?redirect=/upgrade">
        Sign In
      </Link>
    );
  }

  // 🔥 每次都从数据库查询（不使用缓存）
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const isPro = isUserPro(profile);

  console.log(`[UpgradeEntry] User ${user.email} isPro: ${isPro}`);  // 调试日志

  if (isPro) {
    return (
      <Link
        href="/account"
        className="btn btn-secondary"
      >
        Manage
      </Link>
    );
  }

  return (
    <Link
      href="/upgrade"
      className="btn btn-primary"
    >
      Upgrade
    </Link>
  );
}
```

---

### 根因 4.3: 浏览器缓存导致

**修复方案**:
```typescript
// ✅ 在 layout.tsx 添加不缓存的 headers
// app/layout.tsx
export const metadata = {
  title: 'Your App',
  description: 'Description'
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* 🔥 防止浏览器缓存 */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body>
        <nav>
          {/* @ts-expect-error Server Component */}
          <UpgradeEntry />
        </nav>
        {children}
      </body>
    </html>
  );
}
```

---

### 根因 4.4: 需要客户端状态同步

**高级方案**: 使用 Supabase Realtime 替代轮询

```typescript
// ✅ 使用 Supabase Realtime 实时更新
// app/upgrade/success/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';

export default function SuccessPage({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // 🔥 订阅 profiles 表的变更
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
          console.log('Profile updated:', payload);

          if (payload.new.plan === 'pro') {
            console.log('✅ User upgraded to Pro!');
            // 🔥 立即刷新并跳转
            router.refresh();
            setTimeout(() => router.replace('/'), 500);
          }
        }
      )
      .subscribe();

    // 🔥 设置超时保护
    const timeout = setTimeout(() => {
      console.log('⚠️ Realtime timeout, falling back to polling');
      channel.unsubscribe();
      // 启动轮询作为降级方案
    }, 30000);

    return () => {
      clearTimeout(timeout);
      channel.unsubscribe();
    };
  }, [userId, router]);

  return (
    <div>Processing payment...</div>
  );
}
```

**启用 Supabase Realtime**:
```sql
-- 在 Supabase SQL Editor 中执行
-- 1. 启用 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- 2. 设置 Realtime 规则
CREATE POLICY "Users can subscribe to own profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);
```

---

## ✅ 完整解决方案（问题 4）

### 实施步骤:

1. **修复 success 页面竞态** - 等待 refresh 完成再跳转
2. **禁用组件缓存** - 添加 `dynamic = 'force-dynamic'`
3. **添加调试日志** - 确认组件重新渲染
4. **[可选] 升级到 Realtime** - 替代轮询，实时更新

---

# 🎯 统一实施方案

## 实施优先级

### P0 - 立即修复（影响核心功能）

1. ✅ **修复数据库表结构**
   - 添加 `profiles.plan` 和 `profiles.plan_updated_at` 字段
   - 创建 `webhook_events` 表
   - 修复 RLS 策略

2. ✅ **修复 Webhook 处理**
   - 完善 `/api/creem/webhook/route.ts`
   - 添加详细日志
   - 正确提取 `metadata.userId`
   - 处理幂等性

3. ✅ **修复前端轮询**
   - 添加超时保护
   - 指数退避
   - 正确处理响应

4. ✅ **修复权限检查**
   - 统一使用 `isUserPro()` 函数
   - 简化判断逻辑（只看 `plan` 字段）

### P1 - 重要改进（提升用户体验）

5. ✅ **修复 /api/checkout**
   - 添加 Pro 状态检查
   - 返回管理链接

6. ✅ **修复导航栏组件**
   - 根据登录和 Pro 状态显示不同按钮
   - 禁用缓存

7. ✅ **添加登录检查**
   - 在 Upgrade 页面检查登录
   - 处理 redirect 参数

8. ✅ **修复 router.refresh() 竞态**
   - 等待 RSC 渲染完成
   - 添加延迟保护

### P2 - 长期优化（可选）

9. ⭐ **实现 Supabase Realtime**
   - 替代轮询机制
   - 实时状态更新

10. ⭐ **实现 Customer Portal**
    - 创建 `/api/customer-portal` 接口
    - 让用户自助管理订阅

---

## 测试检查清单

### 测试场景 1: 首次购买流程

- [ ] 未登录用户点击 Upgrade → 跳转到登录页
- [ ] 登录后返回 Upgrade 页面
- [ ] 点击 Upgrade → 跳转到 Creem 支付页
- [ ] 完成支付 → 重定向到 /upgrade/success
- [ ] Success 页面轮询检测到 Pro 状态 → 跳转到首页
- [ ] 首页导航栏显示 "Manage" 按钮（不是 "Upgrade"）
- [ ] 访问高级功能 → 可以正常使用

### 测试场景 2: 重复购买防护

- [ ] Pro 用户访问首页 → 导航栏显示 "Manage" 按钮
- [ ] Pro 用户访问 /upgrade → 重定向到 /account
- [ ] Pro 用户调用 /api/checkout → 返回 400 错误和管理链接

### 测试场景 3: Webhook 故障恢复

- [ ] 支付完成但 Webhook 未到达 → Success 页面轮询超时 → 显示提示
- [ ] 查看 webhook_events 表 → 应该有失败记录
- [ ] 手动重放 Webhook → 用户状态更新成功

### 测试场景 4: 数据一致性

- [ ] 查询 profiles.plan → 应该是 'pro'
- [ ] 查询 webhook_events → 应该有成功记录
- [ ] 调用 /api/user/me → 返回 isPro: true
- [ ] 前端 isUserPro() 判断 → 返回 true

---

## SQL 诊断查询

```sql
-- 1. 检查用户当前状态
SELECT
  p.id,
  p.email,
  p.plan,
  p.plan_updated_at,
  (SELECT email FROM auth.users WHERE id = p.id) as auth_email
FROM profiles p
WHERE p.email = 'test@example.com';

-- 2. 检查 Webhook 处理记录
SELECT
  event_id,
  event_type,
  processing_status,
  user_id,
  received_at,
  processed_at,
  error_message
FROM webhook_events
ORDER BY received_at DESC
LIMIT 10;

-- 3. 检查是否有失败的 Webhook
SELECT
  event_id,
  event_type,
  error_message,
  payload
FROM webhook_events
WHERE processing_status = 'failed'
ORDER BY received_at DESC;

-- 4. 数据一致性检查
-- 检查是否有用户在 auth.users 中但不在 profiles 中
SELECT
  u.id,
  u.email,
  p.plan
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL;
```

---

## 环境变量检查清单

```bash
# Supabase
✓ NEXT_PUBLIC_SUPABASE_URL
✓ NEXT_PUBLIC_SUPABASE_ANON_KEY
✓ SUPABASE_SERVICE_ROLE_KEY  # ← 必须是 SERVICE ROLE KEY

# Creem
✓ CREEM_SECRET_KEY  # Test Mode: sk_test_xxx, Live Mode: sk_xxx
✓ CREEM_WEBHOOK_SECRET  # Test Mode: whsec_test_xxx, Live Mode: whsec_xxx
✓ CREEM_PRICE_ID  # price_xxx

# 应用
✓ NEXT_PUBLIC_URL  # 生产环境的完整 URL (https://yourdomain.com)
```

---

## 部署后验证

```bash
# 1. 测试 Webhook 接收
curl -X POST https://yourdomain.com/api/creem/webhook \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test","type":"checkout.session.completed","data":{"metadata":{"userId":"test-user-id"}}}'

# 预期响应: {"received":true,"success":true}

# 2. 测试用户状态 API
curl https://yourdomain.com/api/user/me \
  -H "Cookie: your-auth-cookie"

# 预期响应: {"id":"xxx","email":"xxx","plan":"free","isPro":false}

# 3. 检查 Creem Dashboard
# → Webhooks → Recent deliveries → 应该看到 200 响应
```

---

## 成功标准

支付流程完全正常的标志：

1. ✅ Webhook 100% 到达并成功处理
2. ✅ `profiles.plan` 字段正确更新
3. ✅ `webhook_events` 表有完整记录
4. ✅ 前端轮询在 5 秒内检测到状态变化
5. ✅ 导航栏按钮正确切换（Upgrade → Manage）
6. ✅ 高级功能立即可用
7. ✅ Pro 用户无法重复购买

---

**文档版本**: 1.0
**最后更新**: 2025-11-12
**状态**: 待实施
**预计修复时间**: 2-4 小时
