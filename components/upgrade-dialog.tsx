'use client';

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Crown, Zap, Sparkles, FileDown, Clock, Globe } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface UpgradeDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode | 'transcription'
}

export function UpgradeDialog({ open, onOpenChange, trigger }: UpgradeDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && trigger !== 'transcription' && (
        <DialogPrimitive.Trigger asChild>
          {trigger}
        </DialogPrimitive.Trigger>
      )}

      <DialogPrimitive.Portal>
        {/* Overlay - 背景遮罩 */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Content - 弹窗内容 */}
        <DialogPrimitive.Content
          className={cn(
            // 🔧 修复：使用标准的 Tailwind 类名确保完美居中
            "fixed left-1/2 top-1/2 z-50",
            "grid w-full max-w-lg",
            "-translate-x-1/2 -translate-y-1/2",
            "border bg-background shadow-lg",
            "duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            "sm:rounded-lg sm:max-w-[700px]",
            "p-0 gap-0 overflow-hidden"
          )}
        >
          <div className="grid md:grid-cols-[1fr_1.2fr] gap-0">
            {/* Left Column - 左侧介绍 */}
            <div className="bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 p-8 md:p-10 flex flex-col justify-center">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
                  <Crown className="h-7 w-7 text-primary" />
                </div>
                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                  <h2 className="tracking-tight text-2xl font-bold text-left mb-3">
                    Upgrade for Unlimited AI Summaries
                  </h2>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  You've used all 3 free AI summaries. Upgrade to Pro and unlock unlimited insights.
                </p>
              </div>

              <div className="space-y-3 pt-4 border-t border-primary/20">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Process audio files up to 5 hours long
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Files stored for 7 days (3 days for free users)
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Priority support and faster processing
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column - 右侧功能列表 */}
            <div className="bg-white p-8 md:p-10 flex flex-col justify-center">
              <h3 className="text-lg font-semibold mb-6 text-[#1a1a2e]">Pro Features</h3>

              <div className="space-y-5 mb-8">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1 text-[#1a1a2e]">
                      Unlimited Transcriptions
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Process unlimited audio files without restrictions
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1 text-[#1a1a2e]">
                      Unlimited AI Summaries
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Generate summaries with all templates instantly
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                    <FileDown className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1 text-[#1a1a2e]">
                      Advanced Export
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Export in TXT, DOCX, PDF, and more formats
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1 text-[#1a1a2e]">
                      Extended Storage
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Keep your files for 7 days instead of 3
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <Globe className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1 text-[#1a1a2e]">
                      Multi-language Support
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Transcribe in 40+ languages with high accuracy
                    </p>
                  </div>
                </div>
              </div>

              <Link
                href="/pricing"
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap",
                  "ring-offset-background focus-visible:outline-none focus-visible:ring-2",
                  "focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:pointer-events-none disabled:opacity-50",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "rounded-md px-8 w-full",
                  "bg-gradient-to-r from-primary to-primary/90",
                  "hover:from-primary/90 hover:to-primary",
                  "text-base font-semibold",
                  "shadow-lg shadow-primary/30",
                  "transition-all duration-300",
                  "hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/40",
                  "h-12"
                )}
              >
                <Crown className="mr-2 h-5 w-5" />
                Upgrade to Pro
              </Link>

              <p className="text-center text-xs text-muted-foreground mt-4">
                Cancel anytime • No credit card required for trial
              </p>
            </div>
          </div>

          {/* Close Button - 关闭按钮 */}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
