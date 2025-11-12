# Creem 支付测试失败 - 完整诊断与修复指南

**问题**: 在 Test Mode 完成支付后，Supabase 数据表为空

---

## 🚨 立即执行检查清单

### ✅ 检查 1: Creem Dashboard Webhook 配置 (最可能的原因)

```bash
# 步骤 1: 登录 Creem Dashboard
1. 访问 https://dashboard.creem.io
2. 确保切换到 **Test Mode** (页面右上角开关)
3. 导航: Settings → Webhooks

# 步骤 2: 检查配置
必须看到:
- Endpoint URL: https://你的域名.com/api/creem/webhook
- Status: ✅ Active
- Events:
  ✅ checkout.session.completed
  ✅ payment_intent.succeeded

# 如果没有配置或状态是 Inactive:
→ 点击 "Add endpoint"
→ 输入你的 Webhook URL
→ 选择所有 payment 相关事件
→ 保存并获取 Webhook Secret
```

---

### ✅ 检查 2: 环境变量配置

```bash
# Vercel Dashboard → Settings → Environment Variables
# 或本地 .env.local 文件

# 必须包含以下变量:
CREEM_WEBHOOK_SECRET=whsec_test_xxxxxxxxxxxxxxxxxx  # 注意 _test_ 标识

# 常见错误:
❌ 使用了 Live Mode 的 Secret (whsec_xxx 没有 _test_)
❌ Secret 复制不完整
❌ Secret 包含多余的空格或换行符

# 修复后必须重新部署:
vercel --prod  # 或通过 Dashboard 触发重新部署
```

---

### ✅ 检查 3: 数据库表结构

```sql
-- 登录 Supabase Dashboard → SQL Editor
-- 执行以下 SQL 检查和修复

-- 1. 检查 profiles 表是否有 plan 字段
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles';

-- 2. 如果缺少 plan 字段,添加它
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;
ALTER TABLE profiles ADD CONSTRAINT check_plan_value
  CHECK (plan IN ('anonymous', 'free', 'pro'));

-- 3. 创建 webhook_events 表 (用于幂等性和调试)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  event_object TEXT,
  payload JSONB NOT NULL,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'succeeded', 'failed')),
  user_id UUID REFERENCES profiles(id),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON webhook_events(user_id);

-- 4. 确认你的用户记录存在
SELECT id, email, plan, created_at
FROM profiles
WHERE email = 'verachen1988@gmail.com';

-- 如果不存在,创建记录:
INSERT INTO profiles (id, email, plan, created_at)
SELECT
  id,
  email,
  'free',
  NOW()
FROM auth.users
WHERE email = 'verachen1988@gmail.com'
ON CONFLICT (id) DO NOTHING;
```

---

### ✅ 检查 4: Webhook 处理代码

创建或修改 `app/api/creem/webhook/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // ⚠️ 必须是 SERVICE_ROLE_KEY,不是 ANON_KEY
);

export async function POST(req: Request) {
  const timestamp = new Date().toISOString();
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔔 [${timestamp}] WEBHOOK REQUEST RECEIVED`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    // 1️⃣ 获取原始 body (必须在解析前获取,用于验签)
    const body = await req.text();
    console.log('📦 Raw Body Length:', body.length);
    console.log('📦 Raw Body Preview:', body.substring(0, 200));

    // 2️⃣ 获取签名
    const signature = req.headers.get('creem-signature') ||
                      req.headers.get('stripe-signature') ||
                      req.headers.get('x-creem-signature');
    console.log('🔐 Signature:', signature ? '✅ Present' : '❌ Missing');

    // 3️⃣ 验证签名
    if (signature) {
      const secret = process.env.CREEM_WEBHOOK_SECRET!;
      console.log('🔑 Using Secret:', secret.substring(0, 15) + '...');

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      const isValid = signature.includes(expectedSignature);

      if (!isValid) {
        console.error('❌ SIGNATURE VERIFICATION FAILED');
        console.error('Expected:', expectedSignature.substring(0, 20) + '...');
        console.error('Received:', signature.substring(0, 20) + '...');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      console.log('✅ Signature verified successfully');
    } else {
      console.warn('⚠️ No signature found - skipping verification (ONLY OK FOR TESTING)');
    }

    // 4️⃣ 解析事件
    const event = JSON.parse(body);
    console.log('\n📋 Event Details:');
    console.log('  Type:', event.type);
    console.log('  ID:', event.id);
    console.log('  Object:', event.object);

    // 5️⃣ 提取 userId
    const userId = event.data?.metadata?.userId ||
                   event.data?.object?.metadata?.userId;

    console.log('\n👤 User ID:', userId);

    if (!userId) {
      console.error('❌ Missing userId in metadata!');
      console.error('Full event data:', JSON.stringify(event.data, null, 2));
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // 6️⃣ 幂等性检查 - 插入 webhook_events
    console.log('\n💾 Inserting webhook event...');
    const { data: insertedEvent, error: insertError } = await supabase
      .from('webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        event_object: event.object,
        payload: event,
        user_id: userId,
        processing_status: 'processing'
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {  // Unique constraint violation
        console.log('ℹ️ Event already processed (idempotent)');
        return NextResponse.json({ received: true, idempotent: true }, { status: 200 });
      } else {
        console.error('❌ Database insert error:', insertError);
        throw insertError;
      }
    }

    console.log('✅ Webhook event inserted:', insertedEvent.id);

    // 7️⃣ 处理不同类型的事件
    let updateResult;

    switch (event.type) {
      case 'checkout.session.completed':
      case 'payment_intent.succeeded':
      case 'invoice.paid':
        console.log('\n💳 Processing payment success event...');

        // 更新用户 plan
        updateResult = await supabase
          .from('profiles')
          .update({
            plan: 'pro',
            plan_updated_at: new Date().toISOString()
          })
          .eq('id', userId)
          .select();

        break;

      case 'customer.subscription.deleted':
      case 'invoice.payment_failed':
        console.log('\n🔴 Processing subscription cancellation...');

        updateResult = await supabase
          .from('profiles')
          .update({
            plan: 'free',
            plan_updated_at: new Date().toISOString()
          })
          .eq('id', userId)
          .select();

        break;

      default:
        console.log('⚠️ Unhandled event type:', event.type);
        return NextResponse.json({ received: true, unhandled: true }, { status: 200 });
    }

    // 8️⃣ 检查更新结果
    console.log('\n📊 Update Result:');
    console.log('  Error:', updateResult.error);
    console.log('  Data:', updateResult.data);

    if (updateResult.error) {
      console.error('❌ Failed to update profile:', updateResult.error);

      // 标记 webhook 为失败
      await supabase
        .from('webhook_events')
        .update({
          processing_status: 'failed',
          error_message: updateResult.error.message
        })
        .eq('id', insertedEvent.id);

      throw updateResult.error;
    }

    if (!updateResult.data || updateResult.data.length === 0) {
      console.error('⚠️ No rows updated! User might not exist in profiles table.');
      console.error('User ID:', userId);

      // 尝试查询用户是否存在
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      console.error('Profile exists?', existingProfile ? 'Yes' : 'No');

      if (!existingProfile) {
        // 用户不存在,尝试从 auth.users 创建
        const { data: authUser } = await supabase.auth.admin.getUserById(userId);

        if (authUser.user) {
          console.log('📝 Creating missing profile for user...');
          await supabase.from('profiles').insert({
            id: userId,
            email: authUser.user.email,
            plan: 'pro',
            plan_updated_at: new Date().toISOString()
          });

          console.log('✅ Profile created successfully');
        }
      }
    } else {
      console.log('✅ Successfully updated profile:', updateResult.data[0]);
    }

    // 9️⃣ 标记 webhook 为成功
    await supabase
      .from('webhook_events')
      .update({
        processing_status: 'succeeded',
        processed_at: new Date().toISOString()
      })
      .eq('id', insertedEvent.id);

    console.log('\n✅ Webhook processed successfully\n');
    console.log('='.repeat(70) + '\n');

    return NextResponse.json({ received: true, success: true }, { status: 200 });

  } catch (error: any) {
    console.error('\n💥 FATAL ERROR:', error);
    console.error('Stack:', error.stack);
    console.error('\n' + '='.repeat(70) + '\n');

    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
```

---

### ✅ 检查 5: 本地开发环境 Webhook 接收

如果在本地测试,Creem 无法访问 localhost,必须使用 ngrok:

```bash
# 1. 安装 ngrok
brew install ngrok  # macOS
# 或从 https://ngrok.com/download

# 2. 启动 Next.js
npm run dev

# 3. 在另一个终端启动 ngrok
ngrok http 3000

# 4. 复制 HTTPS URL
Forwarding: https://abc123.ngrok.io -> http://localhost:3000

# 5. 在 Creem Dashboard 更新 Webhook URL
https://abc123.ngrok.io/api/creem/webhook

# 6. 进行测试支付

# 7. 查看 ngrok 日志
访问 http://localhost:4040 查看所有 HTTP 请求
```

---

## 🔍 故障排查 SQL 查询

```sql
-- 查询 1: 检查用户当前状态
SELECT
  p.id,
  p.email,
  p.plan,
  p.plan_updated_at,
  p.created_at,
  (SELECT email FROM auth.users WHERE id = p.id) as auth_email
FROM profiles p
WHERE p.email = 'verachen1988@gmail.com';

-- 查询 2: 检查最近的 Webhook 事件
SELECT
  id,
  event_id,
  event_type,
  processing_status,
  user_id,
  received_at,
  processed_at,
  error_message,
  payload->>'type' as payload_type
FROM webhook_events
ORDER BY received_at DESC
LIMIT 20;

-- 查询 3: 检查失败的 Webhook
SELECT
  event_id,
  event_type,
  error_message,
  received_at,
  payload
FROM webhook_events
WHERE processing_status = 'failed'
ORDER BY received_at DESC;

-- 查询 4: 检查是否有重复的 Webhook 事件
SELECT
  event_id,
  COUNT(*) as count
FROM webhook_events
GROUP BY event_id
HAVING COUNT(*) > 1;

-- 查询 5: 统计 Webhook 处理情况
SELECT
  processing_status,
  COUNT(*) as count,
  MIN(received_at) as first_received,
  MAX(received_at) as last_received
FROM webhook_events
GROUP BY processing_status;
```

---

## 🧪 手动测试 Webhook

### 方法 1: 使用 Creem Dashboard

```bash
1. Creem Dashboard → Developers → Webhooks
2. 选择你的 Endpoint
3. 点击 "Send test webhook"
4. 选择 event type: "checkout.session.completed"
5. 点击 "Send"

检查:
- Response status 应该是 200
- Supabase 中应该出现新记录
- 服务器日志应该有输出
```

### 方法 2: 使用 curl 手动发送

```bash
# 创建测试 payload
curl -X POST https://your-domain.com/api/creem/webhook \
  -H "Content-Type: application/json" \
  -H "creem-signature: test" \
  -d '{
    "id": "evt_test_123456",
    "type": "checkout.session.completed",
    "object": "event",
    "data": {
      "object": {
        "id": "cs_test_123",
        "payment_status": "paid",
        "metadata": {
          "userId": "你的实际用户ID"
        }
      },
      "metadata": {
        "userId": "你的实际用户ID"
      }
    }
  }'
```

---

## 📞 还是不行？最后的诊断步骤

### 1. 检查 Vercel/Netlify 函数日志

```bash
# Vercel
1. 访问 https://vercel.com/dashboard
2. 选择项目 → Logs
3. 筛选 Function: /api/creem/webhook
4. 查看最近的调用记录

# Netlify
1. 访问 https://app.netlify.com
2. 选择项目 → Functions → creem-webhook
3. 查看 Function logs
```

### 2. 检查 RLS (Row Level Security) 策略

```sql
-- Supabase 可能启用了 RLS,导致 Service Role Key 也无法写入

-- 检查 profiles 表的 RLS 状态
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'profiles';

-- 如果 rowsecurity = true,临时禁用 RLS 进行测试
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- 进行测试支付

-- 测试完成后重新启用 (重要!)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 或者添加允许 Service Role 写入的策略
CREATE POLICY "Allow service role to update plan" ON profiles
  FOR UPDATE
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');
```

### 3. 检查 Supabase Service Role Key 权限

```bash
# 在 Supabase Dashboard:
1. Settings → API
2. 确认使用了 "service_role" key (以 eyJ 开头)
3. 不是 "anon" key

# 在代码中:
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // 必须是这个
);
```

---

## ✅ 成功标志

完成上述步骤后,再次测试支付,你应该看到:

### 1. Supabase 中的数据

```sql
-- profiles 表
email: verachen1988@gmail.com
plan: pro  ← 应该从 free 变为 pro
plan_updated_at: 2025-11-12 10:30:00  ← 应该有时间戳

-- webhook_events 表
event_id: evt_xxx
event_type: checkout.session.completed
processing_status: succeeded  ← 应该是 succeeded
processed_at: 2025-11-12 10:30:00
error_message: null
```

### 2. Creem Dashboard

```
Webhooks → [你的 Endpoint] → Recent deliveries
✅ Status: 200 OK
✅ Attempts: 1
✅ Response time: < 1s
```

### 3. 应用前端

```
用户访问首页应该看到:
❌ 之前: "Upgrade to Pro" 按钮
✅ 现在: "Manage Subscription" 按钮
```

---

## 🆘 联系支持

如果以上所有步骤都尝试过仍未解决:

1. **导出诊断信息**:
```sql
-- 执行以下查询并保存结果
SELECT 'profiles' as table_name, * FROM profiles WHERE email = 'verachen1988@gmail.com'
UNION ALL
SELECT 'webhook_events', * FROM webhook_events ORDER BY received_at DESC LIMIT 5;
```

2. **收集日志**:
- Vercel/Netlify 函数日志 (最近 24 小时)
- Creem Dashboard Webhook delivery 日志
- 浏览器 Console 错误信息

3. **检查 Creem 文档**:
- https://docs.creem.io/webhooks
- 确认 Webhook 格式是否有变化

4. **联系 Creem 支持**:
- 提供 Webhook endpoint URL
- 提供测试支付的 checkout session ID
- 询问是否有 Webhook 发送失败日志

---

**文档创建时间**: 2025-11-12
**问题状态**: 待验证
**下一步**: 按照检查清单逐项执行
