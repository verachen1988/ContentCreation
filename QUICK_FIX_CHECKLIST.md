# 🚀 Creem 支付问题快速修复清单

**目标**: 一次性解决 4 个支付相关问题
**预计时间**: 2-4 小时
**优先级**: P0（影响所有付费用户）

---

## 📋 问题总结

| 问题 | 根本原因 | 修复难度 |
|-----|---------|---------|
| 1. 付费后高级功能没开放 | Webhook 处理不完整 / 数据库字段缺失 | ⭐⭐⭐ |
| 2. Pro 用户再次点击付费报错 | 未检查用户状态 | ⭐ |
| 3. 未登录用户可以点击付费 | 缺少登录检查 | ⭐ |
| 4. 付费后 Upgrade 按钮未变化 | RSC 缓存 / 竞态条件 | ⭐⭐ |

---

## ✅ 实施步骤（按顺序）

### 第 1 步: 数据库修复（5 分钟）

```sql
-- 在 Supabase SQL Editor 中执行

-- 1. 确保 profiles 表有必要字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- 2. 添加约束
ALTER TABLE profiles ADD CONSTRAINT check_plan_value
  CHECK (plan IN ('anonymous', 'free', 'pro'));

-- 3. 创建 webhook_events 表
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
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(processing_status);
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);

-- 4. 修复 RLS 策略（允许 Service Role 更新）
CREATE POLICY "service_role_full_access" ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. 验证
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles';
-- 应该看到 'plan' 和 'plan_updated_at' 字段
```

---

### 第 2 步: 修复核心文件（30-60 分钟）

#### 2.1 修复 Webhook 处理

创建或替换 `app/api/creem/webhook/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  console.log('🔔 Webhook received');

  try {
    const body = await req.text();
    const event = JSON.parse(body);

    console.log('Event type:', event.type);
    console.log('Event ID:', event.id);

    // 提取 userId（兼容多种位置）
    const userId = event.data?.metadata?.userId ||
                   event.data?.object?.metadata?.userId;

    if (!userId) {
      console.error('❌ Missing userId');
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    console.log('User ID:', userId);

    // 幂等性检查
    const { error: insertError } = await supabase
      .from('webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        event_object: event.object,
        payload: event,
        user_id: userId,
        processing_status: 'processing'
      });

    if (insertError?.code === '23505') {
      console.log('ℹ️ Duplicate event (idempotent)');
      return NextResponse.json({ received: true, idempotent: true });
    }

    // 处理支付成功事件
    if (event.type === 'checkout.session.completed' ||
        event.type === 'payment_intent.succeeded') {

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          plan: 'pro',
          plan_updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) {
        console.error('❌ Update failed:', updateError);
        throw updateError;
      }

      console.log('✅ User upgraded to Pro');
    }

    // 标记为成功
    await supabase
      .from('webhook_events')
      .update({
        processing_status: 'succeeded',
        processed_at: new Date().toISOString()
      })
      .eq('event_id', event.id);

    return NextResponse.json({ received: true, success: true });

  } catch (error: any) {
    console.error('💥 Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

---

#### 2.2 修复用户状态 API

创建或替换 `app/api/user/me/route.ts`:

```typescript
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_updated_at')
    .eq('id', user.id)
    .single();

  return NextResponse.json({
    id: user.id,
    email: user.email,
    plan: profile?.plan || 'free',
    isPro: profile?.plan === 'pro',
    planUpdatedAt: profile?.plan_updated_at
  }, {
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  });
}
```

---

#### 2.3 修复 Checkout API（防止重复购买）

创建或替换 `app/api/checkout/route.ts`:

```typescript
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 检查登录
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 检查是否已是 Pro
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  if (profile?.plan === 'pro') {
    return NextResponse.json({
      error: 'Already subscribed',
      message: 'You already have an active Pro subscription',
      manageUrl: '/account'
    }, { status: 400 });
  }

  // 创建 Creem Checkout
  const checkout = await fetch('https://api.creem.io/v1/checkout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CREEM_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      line_items: [{ price: process.env.CREEM_PRICE_ID, quantity: 1 }],
      mode: 'subscription',
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
      { error: 'Failed to create checkout' },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: checkout.url });
}
```

---

#### 2.4 修复导航栏组件

创建或替换 `components/nav/UpgradeEntry.tsx`:

```typescript
import { createSupabaseServerClient } from '@/lib/supabase-server';
import Link from 'next/link';

// 禁用缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function UpgradeEntry() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 未登录
  if (!user) {
    return (
      <Link href="/login?redirect=/upgrade" className="btn btn-primary">
        Sign In
      </Link>
    );
  }

  // 获取用户状态
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const isPro = profile?.plan === 'pro';

  // Pro 用户显示 Manage
  if (isPro) {
    return (
      <Link href="/account" className="btn btn-secondary">
        Manage
      </Link>
    );
  }

  // 免费用户显示 Upgrade
  return (
    <Link href="/upgrade" className="btn btn-primary">
      Upgrade
    </Link>
  );
}
```

---

#### 2.5 修复付费成功页面

创建或替换 `app/upgrade/success/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SuccessPage() {
  const [status, setStatus] = useState<'processing' | 'ready' | 'timeout'>('processing');
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 30;
    let pollInterval = 1000;

    const pollStatus = async () => {
      try {
        const response = await fetch('/api/user/me', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        const data = await response.json();

        if (data.isPro === true) {
          console.log('✅ Payment confirmed');
          setStatus('ready');

          // 刷新 RSC 并跳转
          await router.refresh();
          await new Promise(r => setTimeout(r, 500));
          router.replace('/');
          return;
        }

        attempts++;

        if (attempts >= maxAttempts) {
          setStatus('timeout');
          return;
        }

        pollInterval = Math.min(pollInterval * 1.5, 10000);
        setTimeout(pollStatus, pollInterval);

      } catch (error) {
        console.error('Poll error:', error);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(pollStatus, pollInterval);
        }
      }
    };

    pollStatus();
  }, [router]);

  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-lg">Processing your payment...</p>
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-yellow-600 text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold mt-4">Processing Timeout</h1>
        <p className="text-gray-600 mt-2">Please check back in a few minutes</p>
        <button onClick={() => router.push('/')} className="mt-4 btn btn-primary">
          Return to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-green-600 text-5xl">✅</div>
      <h1 className="text-2xl font-bold mt-4">Payment Successful!</h1>
    </div>
  );
}
```

---

#### 2.6 修复权限判断函数

创建或替换 `lib/auth.ts`:

```typescript
export interface ProfileLite {
  plan?: string;
}

export function isUserPro(profile: ProfileLite | null): boolean {
  return profile?.plan === 'pro';
}
```

---

### 第 3 步: 环境变量检查（5 分钟）

确保 `.env.local` 或 Vercel 环境变量包含:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...  # ← 必须是 SERVICE ROLE KEY

# Creem
CREEM_SECRET_KEY=sk_test_xxx  # Test Mode
CREEM_WEBHOOK_SECRET=whsec_test_xxx  # Test Mode
CREEM_PRICE_ID=price_xxx

# App
NEXT_PUBLIC_URL=https://yourdomain.com
```

---

### 第 4 步: Creem Dashboard 配置（5 分钟）

1. 登录 https://dashboard.creem.io
2. 切换到 **Test Mode** (右上角)
3. 导航: Settings → Webhooks
4. 添加 Endpoint:
   - URL: `https://yourdomain.com/api/creem/webhook`
   - Events: 选择所有 `checkout.*` 和 `payment.*` 事件
5. 复制 Webhook Secret 到环境变量
6. 保存

---

### 第 5 步: 部署并测试（10 分钟）

```bash
# 1. 提交代码
git add .
git commit -m "fix: 修复 Creem 支付流程的 4 个问题"
git push

# 2. 部署（Vercel 会自动部署）
# 或手动触发
vercel --prod

# 3. 测试 Webhook 接收
curl -X POST https://yourdomain.com/api/creem/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_123",
    "type": "checkout.session.completed",
    "object": "event",
    "data": {
      "metadata": {
        "userId": "你的真实用户ID"
      }
    }
  }'

# 预期响应: {"received":true,"success":true}
```

---

## 🧪 完整测试流程

### 测试 1: 未登录用户

1. 退出登录
2. 访问首页
3. **预期**: 导航栏显示 "Sign In" 按钮
4. 点击 Upgrade
5. **预期**: 重定向到 `/login?redirect=/upgrade`

### 测试 2: 免费用户购买

1. 登录（免费用户）
2. 访问首页
3. **预期**: 导航栏显示 "Upgrade" 按钮
4. 点击 Upgrade
5. **预期**: 跳转到 Creem 支付页
6. 完成支付（Test Mode: 使用 4242 4242 4242 4242）
7. **预期**: 重定向到 `/upgrade/success`
8. **预期**: Success 页面显示 "Processing..."
9. **预期**: 1-5 秒后自动跳转到首页
10. **预期**: 导航栏显示 "Manage" 按钮

### 测试 3: Pro 用户重复购买

1. 登录（Pro 用户）
2. 访问首页
3. **预期**: 导航栏显示 "Manage" 按钮
4. 尝试访问 `/upgrade`
5. **预期**: 重定向到 `/account`（如果实现了）
6. 尝试调用 `/api/checkout`
7. **预期**: 返回 400 错误和管理链接

---

## 🔍 故障排查

### 问题: Webhook 未触发

```sql
-- 1. 检查 webhook_events 表
SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 5;

-- 如果为空:
-- → 检查 Creem Dashboard → Webhooks → Recent deliveries
-- → 确认 Webhook URL 正确
-- → 确认环境变量 CREEM_WEBHOOK_SECRET 正确

-- 如果有记录但 processing_status = 'failed':
-- → 查看 error_message 字段
SELECT event_id, error_message FROM webhook_events WHERE processing_status = 'failed';
```

### 问题: plan 字段未更新

```sql
-- 检查用户状态
SELECT id, email, plan, plan_updated_at
FROM profiles
WHERE email = 'test@example.com';

-- 检查 RLS 策略
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename = 'profiles';

-- 临时禁用 RLS 测试（记得重新启用！）
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
-- 测试...
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
```

### 问题: 前端一直显示 "Processing..."

```javascript
// 在浏览器 Console 中执行
fetch('/api/user/me', {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' }
})
.then(r => r.json())
.then(console.log);

// 应该看到: { isPro: true, plan: 'pro', ... }
// 如果 isPro = false，说明数据库未更新
```

---

## ✅ 成功验证清单

完成后，以下所有项应该为 ✅:

- [ ] 数据库有 `profiles.plan` 和 `webhook_events` 表
- [ ] Creem Dashboard 显示 Webhook 配置为 Active
- [ ] 测试支付后，`webhook_events` 有成功记录
- [ ] 测试支付后，`profiles.plan` 更新为 'pro'
- [ ] 测试支付后，前端在 5 秒内完成轮询
- [ ] 测试支付后，导航栏从 "Upgrade" 变为 "Manage"
- [ ] Pro 用户访问 `/api/checkout` 返回 400 错误
- [ ] 未登录用户点击 Upgrade 跳转到登录页

---

## 📞 需要帮助？

如果遇到问题:

1. 查看 Vercel 函数日志: `vercel logs`
2. 查看 Supabase 日志: Dashboard → Logs
3. 查看 Creem Webhook 日志: Dashboard → Webhooks → Recent deliveries
4. 执行上面的 SQL 诊断查询
5. 参考详细文档: `PAYMENT_ISSUES_ROOT_CAUSE_ANALYSIS.md`

---

**预计总时间**: 2-4 小时
**建议**: 在 Test Mode 完全测试通过后再切换到 Live Mode
