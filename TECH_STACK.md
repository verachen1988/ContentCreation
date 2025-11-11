# 技术栈文档

本文档详细介绍了 ContentCreation 项目使用的技术栈和架构设计。

---

## 1️⃣ 前端框架

### **Next.js 14+ (App Router)**
- ✅ 使用 App Router 架构（而非 Pages Router）
- ✅ 文件路径示例：`app/app/result/[jobId]/page.tsx`
- ✅ 支持服务端组件（RSC）和客户端组件（`'use client'`）
- ✅ 内置 API Routes：`app/api/transcribe/route.ts`

### **React 18+**
- 使用最新的 Hooks：`useState`, `useEffect`, `useCallback`, `useMemo`
- 服务端渲染（SSR）+ 客户端交互

---

## 2️⃣ UI 库

### **shadcn/ui**
这是一个基于 Radix UI 的高质量组件库（复制到项目中，而非 npm 包）

使用的组件：
```typescript
- Button
- Card, CardContent, CardHeader, CardTitle, CardDescription
- Badge
- Alert, AlertDialog, AlertDescription
- Dialog, DialogContent, DialogHeader
- DropdownMenu, DropdownMenuTrigger, DropdownMenuItem
- Tabs, TabsList, TabsTrigger, TabsContent
- Separator
```

### **Tailwind CSS**
用于样式系统：
```typescript
// 示例：代码中的 Tailwind 类名
className="flex min-h-screen flex-col pt-16"
className="mx-auto h-12 w-12 animate-spin text-primary"
```

### **Lucide React**
图标库：
```typescript
import { Download, FileText, Sparkles, Clock, Loader2 } from 'lucide-react';
```

---

## 3️⃣ 鉴权系统

### **Supabase Auth**
使用 Supabase 的完整认证解决方案：

#### 功能特性：
- ✅ **Google OAuth 登录**
  ```typescript
  signInWithOAuth({ provider: 'google' })
  ```

- ✅ **匿名用户支持**
  - 使用设备 ID 追踪匿名用户
  - `lib/device-id.ts` 中的 `getOrCreateDeviceId()`

- ✅ **Session 管理**
  ```typescript
  // 客户端
  createSupabaseBrowserClient()

  // 服务端
  supabaseAdmin (from lib/supabase-admin.ts)
  ```

- ✅ **用户类型区分**
  - `anonymous`：未登录用户
  - `free`：免费注册用户
  - `pro`：付费用户

#### 鉴权流程：
```typescript
// 1. 用户点击 Google 登录
components/auth/auth-dialog.tsx → signInWithOAuth()

// 2. OAuth 回调处理
app/auth/callback/route.ts → exchangeCodeForSession()

// 3. 全局状态管理
lib/auth-context.tsx → AuthProvider → useAuth()

// 4. 受保护的 API 路由
app/api/transcribe/route.ts → 检查 userId 或 deviceId
```

---

## 4️⃣ 数据库与存储

### **Supabase (PostgreSQL)**
- 后端数据库服务
- 实时功能支持
- 用户数据管理
- 作业状态追踪

### **Cloudflare R2**
- 音频文件存储
- S3 兼容的对象存储
- 高性能、低成本

---

## 5️⃣ AI 服务

### **Deepgram**
- 语音转写服务
- 高精度音频转文本
- 支持多种语言

### **DeepSeek**
- AI 内容总结
- 智能文本生成
- 内容优化

---

## 6️⃣ 状态管理与通知

### **React Context**
- 轻量级状态管理
- 用户认证状态
- 全局应用状态

### **Sonner**
- Toast 通知库
- 优雅的用户反馈
- 成功/错误/警告提示

---

## 7️⃣ 国际化

### **react-i18next**
- 多语言支持
- 支持 40+ 种语言
- 动态语言切换
- 翻译文件管理

---

## 📊 完整技术栈总结

| 类别 | 技术 | 用途 |
|------|------|------|
| **前端框架** | Next.js 14 (App Router) | React 全栈框架 |
| **UI 组件库** | shadcn/ui + Radix UI | 无障碍、可定制组件 |
| **样式系统** | Tailwind CSS | 实用优先的 CSS 框架 |
| **图标** | Lucide React | SVG 图标库 |
| **认证** | Supabase Auth | OAuth + Session 管理 |
| **数据库** | Supabase (PostgreSQL) | 后端数据库 + 实时功能 |
| **存储** | Cloudflare R2 | 音频文件存储 |
| **AI 服务** | Deepgram + DeepSeek | 语音转写 + AI 总结 |
| **状态管理** | React Context + useState | 轻量级状态管理 |
| **通知** | Sonner | Toast 通知库 |
| **国际化** | react-i18next | 多语言支持（40+ 语言）|

---

## 🏗️ 项目架构

### 目录结构
```
ContentCreation/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   ├── auth/              # 认证相关页面
│   └── result/            # 结果展示页面
├── components/            # React 组件
│   ├── auth/             # 认证组件
│   └── ui/               # shadcn/ui 组件
├── lib/                   # 工具函数和配置
│   ├── auth-context.tsx  # 认证上下文
│   ├── device-id.ts      # 设备 ID 管理
│   └── supabase-admin.ts # Supabase 管理客户端
└── public/               # 静态资源
```

### 核心功能流程

#### 1. 用户认证流程
```
访客 → 匿名用户（设备 ID）→ Google OAuth → 注册用户 → 付费用户
```

#### 2. 音频处理流程
```
上传音频 → R2 存储 → Deepgram 转写 → DeepSeek 总结 → 结果展示
```

#### 3. API 路由保护
```
请求 → 认证中间件 → 权限检查 → 业务逻辑 → 响应
```

---

## 🔧 开发工具链

- **TypeScript**：类型安全
- **ESLint**：代码质量
- **Prettier**：代码格式化
- **Git**：版本控制

---

## 📦 依赖管理

使用 npm 或 yarn 管理依赖包：

### 核心依赖
- `next` - Next.js 框架
- `react` - React 库
- `@supabase/supabase-js` - Supabase 客户端
- `tailwindcss` - CSS 框架
- `lucide-react` - 图标库
- `sonner` - 通知库
- `react-i18next` - 国际化

### UI 组件依赖
- `@radix-ui/*` - Radix UI 组件
- `class-variance-authority` - 样式变体管理
- `clsx` - 类名工具
- `tailwind-merge` - Tailwind 类名合并

---

## 🚀 部署架构

- **前端托管**：Vercel / Netlify（推荐）
- **数据库**：Supabase Cloud
- **存储**：Cloudflare R2
- **API**：Next.js API Routes（Serverless）
- **CDN**：自动配置（通过托管平台）

---

## 🔐 安全考虑

1. **认证**：OAuth 2.0 标准
2. **会话管理**：JWT + HttpOnly Cookies
3. **API 保护**：中间件鉴权
4. **环境变量**：敏感信息加密存储
5. **CORS**：配置允许的源
6. **XSS 防护**：React 内置保护
7. **CSRF 防护**：SameSite Cookie 属性

---

## 📈 性能优化

1. **服务端渲染（SSR）**：首屏加载优化
2. **增量静态生成（ISR）**：动态内容静态化
3. **图片优化**：Next.js Image 组件
4. **代码分割**：自动化代码分割
5. **缓存策略**：CDN + 浏览器缓存
6. **懒加载**：React.lazy + Suspense

---

## 🧪 测试策略

建议的测试工具栈：
- **单元测试**：Jest + React Testing Library
- **集成测试**：Playwright / Cypress
- **类型检查**：TypeScript
- **端到端测试**：Playwright

---

## 📚 相关资源

- [Next.js 文档](https://nextjs.org/docs)
- [shadcn/ui 文档](https://ui.shadcn.com)
- [Supabase 文档](https://supabase.com/docs)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React 文档](https://react.dev)

---

*最后更新时间：2025-11-11*
