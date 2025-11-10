'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UpgradeDialog } from '@/components/upgrade-dialog';

export default function Home() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-primary/5 p-8">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-[#1a1a2e] mb-4">
            升级弹窗居中测试
          </h1>
          <p className="text-lg text-muted-foreground">
            点击下面的按钮测试升级弹窗的居中效果
          </p>
        </div>

        <Card className="p-8 md:p-12 bg-white/80 backdrop-blur-sm">
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-semibold text-[#1a1a2e] mb-4">
                问题分析
              </h2>
              <div className="space-y-3 text-muted-foreground">
                <p className="flex items-start gap-2">
                  <span className="text-red-500 font-bold">❌</span>
                  <span>
                    <strong>原问题：</strong>使用了自定义值 <code className="bg-slate-100 px-2 py-1 rounded">left-[50%] top-[50%]</code> 和 <code className="bg-slate-100 px-2 py-1 rounded">translate-x-[-50%] translate-y-[-50%]</code>
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-orange-500 font-bold">⚠️</span>
                  <span>
                    Tailwind CSS 的 JIT 模式可能无法正确编译这些自定义值
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✅</span>
                  <span>
                    <strong>解决方案：</strong>使用 Tailwind 的标准类名：<code className="bg-slate-100 px-2 py-1 rounded">left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2</code>
                  </span>
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-[#1a1a2e] mb-4">
                修复要点
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-[#1a1a2e] mb-2">修复前：</h3>
                  <pre className="text-xs bg-white p-3 rounded overflow-x-auto">
                    <code>{`left-[50%] top-[50%]
translate-x-[-50%]
translate-y-[-50%]`}</code>
                  </pre>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-[#1a1a2e] mb-2">修复后：</h3>
                  <pre className="text-xs bg-white p-3 rounded overflow-x-auto">
                    <code>{`left-1/2 top-1/2
-translate-x-1/2
-translate-y-1/2`}</code>
                  </pre>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t">
              <h2 className="text-2xl font-semibold text-[#1a1a2e] mb-4">
                测试弹窗
              </h2>
              <p className="text-muted-foreground mb-6">
                点击按钮打开升级弹窗，弹窗应该在页面中完美居中显示
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  onClick={() => setShowDialog(true)}
                  className="bg-primary hover:bg-primary/90"
                >
                  打开升级弹窗
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    const info = `
窗口尺寸：${window.innerWidth}x${window.innerHeight}
滚动位置：${window.scrollY}
设备像素比：${window.devicePixelRatio}
                    `.trim();
                    alert(info);
                  }}
                >
                  查看页面信息
                </Button>
              </div>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
              <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                测试说明
              </h3>
              <ul className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start gap-2">
                  <span className="font-bold">1.</span>
                  <span>点击"打开升级弹窗"按钮</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold">2.</span>
                  <span>检查弹窗是否在屏幕正中央显示</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold">3.</span>
                  <span>尝试调整浏览器窗口大小，弹窗应始终保持居中</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold">4.</span>
                  <span>在不同屏幕尺寸下测试（手机、平板、桌面）</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>

        {/* Upgrade Dialog */}
        <UpgradeDialog
          open={showDialog}
          onOpenChange={setShowDialog}
        />
      </div>
    </main>
  );
}
