'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import { LanguageDetector } from '@/components/language-detector';
import { Badge } from '@/components/ui/badge';
import { ProcessingModal } from '@/components/processing-modal';
import { Upload, Sparkles, Zap, FileText, Star, CheckCircle, ArrowRight, Play, FileClock, Bolt, Target, LayoutTemplate, Mail, Globe } from 'lucide-react';
import { useTranslation, type Language } from '@/lib/i18n';
import { getInitialLanguage, saveLanguagePreference } from '@/lib/language-storage';
import { getOrCreateDeviceId } from '@/lib/device-id';
import { UpgradeDialog } from '@/components/upgrade-dialog';

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentLang, setCurrentLang] = useState<Language>('en');
  const [isYearly, setIsYearly] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string>('auto');
  const [outputLanguage, setOutputLanguage] = useState<string>('en');
  const [speakerMode, setSpeakerMode] = useState<'none' | 'single' | 'dialog' | 'multi'>('multi');
  const [translationMode, setTranslationMode] = useState<'transcribe' | 'translate'>('transcribe');
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const fileInputRef = useState<HTMLInputElement | null>(null)[0];

  useEffect(() => {
    setCurrentLang(getInitialLanguage());
  }, []);

  const handleLanguageChange = useCallback((lang: Language) => {
    setCurrentLang(lang);
    saveLanguagePreference(lang);
    // 标记用户已经主动选择过语言
    localStorage.setItem('user-selected-language', 'true');
  }, []);

  const t = useTranslation(currentLang);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      const detected = 'en';
      setDetectedLanguage(detected);
      setOutputLanguage(detected);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const detected = 'en';
      setDetectedLanguage(detected);
      setOutputLanguage(detected);
    }
  }, []);

  const handleButtonClick = useCallback(() => {
    const input = document.getElementById('file-input') as HTMLInputElement;
    if (input) {
      input.click();
    }
  }, []);

  const handleTranscribe = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    setTranscriptionError(null);

    try {
      const deviceId = getOrCreateDeviceId();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('deviceId', deviceId);
      formData.append('inputLanguage', detectedLanguage);
      // 将前端的 speaker 模式映射到后端：dialog 和 multi 都启用多说话人识别
      const backendSpeakerMode = (speakerMode === 'dialog' || speakerMode === 'multi') ? 'multiple' : 'single';
      formData.append('speakerMode', backendSpeakerMode);
      formData.append('translationMode', translationMode);

      console.log('🚀 开始上传音频...');
      console.log('📁 文件信息:', {
        name: file.name,
        size: file.size,
        type: file.type,
      });

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      console.log('📡 收到响应:', {
        status: response.status,
        ok: response.ok,
      });

      const data = await response.json();
      console.log('📦 响应数据:', data);

      if (!response.ok) {
        if (data.needsUpgrade) {
          // 配额用完，显示升级弹窗
          setShowUpgradeDialog(true);
          setIsProcessing(false);
          return;
        }
        throw new Error(data.error || 'Transcription failed');
      }

      // 验证 jobId
      if (!data.jobId) {
        console.error('❌ 响应中没有 jobId!');
        console.error('完整响应:', JSON.stringify(data, null, 2));
        throw new Error('No job ID returned from server');
      }

      console.log('✅ 转写成功，准备跳转');
      console.log('🔗 Job ID:', data.jobId);
      console.log('🔗 Job ID type:', typeof data.jobId);
      console.log('🔗 跳转 URL:', `/app/result/${data.jobId}`);

      // 转写成功，跳转到结果页面
      // 使用 window.location.href 强制跳转，确保不会回到首页
      const resultUrl = `/app/result/${data.jobId}`;
      console.log('🚀 执行跳转到:', resultUrl);

      // 使用 window.location.href 强制页面跳转，避免路由问题
      window.location.href = resultUrl;
    } catch (error: any) {
      console.error('Transcription error:', error);
      setTranscriptionError(error.message || 'Failed to transcribe audio');
      setIsProcessing(false);
    }
  }, [file, detectedLanguage, speakerMode, translationMode, router]);

  const testimonialsColumn1 = [
    {
      name: "Sarah Chen",
      role: "Freelance Journalist",
      avatar: "https://i.pravatar.cc/150?img=1",
      content: "Saved me 3 hours on my last interview. The AI summary is incredibly accurate!",
      rating: 5
    },
    {
      name: "Marcus Rodriguez",
      role: "Sales Manager",
      avatar: "https://i.pravatar.cc/150?img=3",
      content: "Never miss a client detail again. This tool is a game-changer for my sales calls.",
      rating: 5
    },
    {
      name: "Yuki Tanaka",
      role: "Content Creator",
      avatar: "https://i.pravatar.cc/150?img=5",
      content: "Turned my podcast into blog posts in minutes. Amazing!",
      rating: 5
    },
    {
      name: "Emma Wilson",
      role: "Product Manager",
      avatar: "https://i.pravatar.cc/150?img=9",
      content: "Incredible time saver for our team meetings. The action items extraction is spot on!",
      rating: 5
    }
  ];

  const testimonialsColumn2 = [
    {
      name: "David Kim",
      role: "Business Consultant",
      avatar: "https://i.pravatar.cc/150?img=12",
      content: "The multi-language support is impressive. Helps me work with international clients seamlessly.",
      rating: 5
    },
    {
      name: "Lisa Anderson",
      role: "University Professor",
      avatar: "https://i.pravatar.cc/150?img=24",
      content: "Makes lecture transcription effortless. My students love having accurate notes!",
      rating: 5
    },
    {
      name: "James Taylor",
      role: "Legal Assistant",
      avatar: "https://i.pravatar.cc/150?img=33",
      content: "Accurate transcription for depositions and meetings. Saves hours of manual work.",
      rating: 5
    },
    {
      name: "Nina Patel",
      role: "Marketing Director",
      avatar: "https://i.pravatar.cc/150?img=47",
      content: "Perfect for capturing client feedback and turning it into actionable insights.",
      rating: 5
    }
  ];

  const testimonialsColumn3 = [
    {
      name: "Carlos Mendez",
      role: "Startup Founder",
      avatar: "https://i.pravatar.cc/150?img=51",
      content: "Essential tool for our team. We use it daily for standups and client calls.",
      rating: 5
    },
    {
      name: "Sophie Laurent",
      role: "HR Manager",
      avatar: "https://i.pravatar.cc/150?img=20",
      content: "Interview transcriptions have never been easier. Helps us make better hiring decisions.",
      rating: 5
    },
    {
      name: "Alex Chen",
      role: "Video Producer",
      avatar: "https://i.pravatar.cc/150?img=60",
      content: "Speeds up my editing workflow tremendously. The timestamps are incredibly helpful!",
      rating: 5
    },
    {
      name: "Maria Garcia",
      role: "Research Analyst",
      avatar: "https://i.pravatar.cc/150?img=28",
      content: "Analyzing interviews is so much faster now. The AI summaries capture key themes perfectly.",
      rating: 5
    }
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 pt-16">
        <section className="relative overflow-hidden py-24 md:py-32 lg:py-40">
          <div className="absolute inset-0 -z-10 opacity-30">
            <div className="animate-pulse-glow absolute left-1/4 top-0 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
            <div className="animate-pulse-glow absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-accent/20 blur-3xl" style={{ animationDelay: '1s' }} />
          </div>

          <div className="container relative mx-auto px-4">
            <div className="mx-auto max-w-6xl">
              <h1 className="mb-6 text-center text-4xl font-bold leading-tight tracking-tight text-[#1a1a2e] md:text-5xl lg:text-6xl xl:text-7xl animate-in fade-in duration-700 whitespace-nowrap">
                Turn Audio into Insights <span className="gradient-text">Instantly</span>
              </h1>

              <p className="mx-auto mb-8 max-w-5xl text-center text-lg text-muted-foreground md:text-xl animate-in fade-in duration-700 whitespace-nowrap" style={{ animationDelay: '0.2s' }}>
                Get accurate transcriptions and summaries with world's first class AI-powered technology
              </p>

              <div className="mb-12 flex flex-wrap items-center justify-center gap-3 animate-in fade-in duration-700" style={{ animationDelay: '0.4s' }}>
                <Badge className="border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-transform hover:scale-105">
                  <Sparkles className="mr-2 h-4 w-4" />
                  AI-Powered
                </Badge>
                <Badge className="border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition-transform hover:scale-105">
                  <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Privacy Protected
                </Badge>
                <Badge className="border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-transform hover:scale-105">
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Free to Upload
                </Badge>
              </div>

              <div className="mx-auto mb-16 max-w-4xl animate-in fade-in duration-700" style={{ animationDelay: '0.6s' }}>
                <Card className="overflow-hidden border-2 border-primary/10 bg-white/60 shadow-2xl shadow-primary/5 backdrop-blur-md transition-all duration-300">
                  {!file ? (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`group relative p-16 text-center transition-all duration-300 ${
                        isDragging ? 'bg-primary/5 scale-[0.98]' : ''
                      }`}
                    >
                      <input
                        id="file-input"
                        type="file"
                        accept=".mp3,.m4a,.wav,.mp4,.wmv,.m4v,.flv,.rmvb,.dat,.mov,.mkv,.webm,.avi,.mpeg,.3gp,.ogg,.wma,.aac,.amr,.flac,.aiff"
                        onChange={handleFileSelect}
                        className="hidden"
                      />

                      <div className="mx-auto mb-8 flex h-28 w-28 items-center justify-center rounded-full bg-primary/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-primary/20">
                        <Upload className="h-14 w-14 text-primary transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="mb-3 text-2xl font-semibold text-[#1a1a2e] transition-colors group-hover:text-primary">
                        {t.hero.uploadTitle}
                      </h3>
                      <p className="mb-8 text-muted-foreground">
                        {t.hero.uploadSubtitle.prefix && <>{t.hero.uploadSubtitle.prefix} </>}
                        <span className="font-semibold text-primary">{t.hero.uploadSubtitle.formats}</span>
                        {t.hero.uploadSubtitle.middle && <> {t.hero.uploadSubtitle.middle} </>}
                        <span className="font-semibold text-primary">{t.hero.uploadSubtitle.minutes}</span>
                        {t.hero.uploadSubtitle.suffix && <> {t.hero.uploadSubtitle.suffix}</>}
                      </p>
                      <Button
                        size="lg"
                        onClick={handleButtonClick}
                        className="h-14 bg-primary px-10 text-base font-medium shadow-lg shadow-primary/30 transition-all duration-300 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/40 shine-effect"
                      >
                        {t.hero.chooseFile}
                        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-0 md:grid-cols-[380px_1fr]">
                      <div className="border-r border-primary/10 bg-white/40 p-6 md:p-8">
                        <div className="space-y-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-green-50">
                              <CheckCircle className="h-6 w-6 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <h3 className="text-base font-bold text-[#1a1a2e]">File Uploaded</h3>
                              <p className="break-all text-xs text-muted-foreground leading-tight">{file.name}</p>
                            </div>
                          </div>

                          <div className="space-y-2 rounded-lg bg-slate-50/80 p-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">File Size</span>
                              <span className="text-sm font-semibold text-[#1a1a2e]">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Format</span>
                              <span className="text-sm font-semibold text-[#1a1a2e]">{file.name.split('.').pop()?.toUpperCase()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Status</span>
                              <Badge className="bg-green-50 text-green-700 hover:bg-green-50 text-xs">Ready</Badge>
                            </div>
                          </div>

                          <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#1a1a2e]">Upload Progress</span>
                              <span className="text-xs font-bold text-primary">100%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-white">
                              <div className="h-full w-full bg-primary transition-all duration-500"></div>
                            </div>
                            <p className="text-xs text-muted-foreground">File uploaded successfully</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-slate-50/50 to-white/50 p-8 md:p-10">
                        <div className="mx-auto max-w-xl space-y-6">
                          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md">
                            <h3 className="mb-3 text-sm font-bold text-[#1a1a2e] flex items-center gap-2">
                              <Globe className="h-4 w-4 text-primary" />
                              Input Language
                            </h3>
                            <select
                              value={detectedLanguage}
                              onChange={(e) => {
                                setDetectedLanguage(e.target.value);
                                if (e.target.value !== 'auto') {
                                setOutputLanguage(e.target.value);
                                }
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-[#1a1a2e] transition-all duration-200 hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            >
                              <option value="auto">🔍 Auto Detect (Recommended)</option>
                              <option value="en">English</option>
                              <option value="zh">Chinese (中文)</option>
                              <option value="ja">Japanese (日本語)</option>
                              <option value="ko">Korean (한국어)</option>
                              <option value="es">Spanish (Español)</option>
                              <option value="fr">French (Français)</option>
                              <option value="de">German (Deutsch)</option>
                              <option value="it">Italian (Italiano)</option>
                              <option value="pt">Portuguese (Português)</option>
                              <option value="ru">Russian (Русский)</option>
                              <option value="ar">Arabic (العربية)</option>
                              <option value="hi">Hindi (हिन्दी)</option>
                              <option value="th">Thai (ไทย)</option>
                              <option value="vi">Vietnamese (Tiếng Việt)</option>
                            </select>
                          </div>

                          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md">
                            <h3 className="mb-3 text-sm font-bold text-[#1a1a2e] flex items-center gap-2">
                              <Globe className="h-4 w-4 text-primary" />
                              Output Language
                            </h3>
                            <select
                              value={outputLanguage}
                              onChange={(e) => setOutputLanguage(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-[#1a1a2e] transition-all duration-200 hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            >
                              <option value="en">English</option>
                              <option value="zh">Chinese (中文)</option>
                              <option value="ja">Japanese (日本語)</option>
                              <option value="ko">Korean (한국어)</option>
                              <option value="es">Spanish (Español)</option>
                              <option value="fr">French (Français)</option>
                              <option value="de">German (Deutsch)</option>
                              <option value="it">Italian (Italiano)</option>
                              <option value="pt">Portuguese (Português)</option>
                              <option value="ru">Russian (Русский)</option>
                              <option value="ar">Arabic (العربية)</option>
                              <option value="hi">Hindi (हिन्दी)</option>
                              <option value="th">Thai (ไทย)</option>
                              <option value="vi">Vietnamese (Tiếng Việt)</option>
                            </select>
                          </div>

                            </div>

                        <div className="mt-8 pt-6 border-t border-primary/10">
                          <div className="mb-4 rounded-lg border border-blue-200/80 bg-blue-50/50 p-4 flex items-start gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
                              <Sparkles className="h-4 w-4 text-blue-600" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-blue-900 mb-1">Multi-Speaker Recognition Enabled</p>
                              <p className="text-xs text-blue-700">
                                Different speakers will be automatically identified and color-coded in the transcription
                              </p>
                          </div>
                        </div>

                          {transcriptionError && (
                            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                              {transcriptionError}
                            </div>
                          )}
                          <Button
                            size="lg"
                            onClick={handleTranscribe}
                            disabled={isProcessing}
                            className="h-14 w-full bg-gradient-to-r from-primary to-primary/90 text-base font-bold shadow-lg shadow-primary/30 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Sparkles className="mr-2 h-5 w-5" />
                            {isProcessing ? 'Processing...' : 'Start Transcription'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              <div className="flex flex-nowrap items-center justify-center gap-8 lg:gap-12 animate-in fade-in duration-700 overflow-x-auto" style={{ animationDelay: '0.8s' }}>
                <div className="group flex items-center gap-3 transition-transform duration-300 hover:scale-110">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 transition-all duration-300 group-hover:bg-green-100 group-hover:shadow-lg">
                    <CheckCircle className="h-5 w-5 text-green-600 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <span className="font-medium text-[#1a1a2e]">{t.hero.freeToStart}</span>
                </div>
                <div className="group flex items-center gap-3 transition-transform duration-300 hover:scale-110">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-50 transition-all duration-300 group-hover:bg-yellow-100 group-hover:shadow-lg">
                    <Zap className="h-5 w-5 text-yellow-600 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <span className="font-medium text-[#1a1a2e]">{t.hero.fastResults}</span>
                </div>
                <div className="group flex items-center gap-3 transition-transform duration-300 hover:scale-110">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 transition-all duration-300 group-hover:bg-blue-100 group-hover:shadow-lg">
                    <FileText className="h-5 w-5 text-blue-600 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <span className="font-medium text-[#1a1a2e]">{t.hero.multiLanguage}</span>
                </div>
                <div className="group flex items-center gap-3 transition-transform duration-300 hover:scale-110">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 transition-all duration-300 group-hover:bg-purple-100 group-hover:shadow-lg">
                    <FileClock className="h-5 w-5 text-purple-600 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <span className="font-medium text-[#1a1a2e]">{t.hero.summaryTemplates}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-28 border-t border-primary/5 bg-white/40 py-24 backdrop-blur-sm">
          <div className="container mx-auto px-4">
            <div className="mb-20 text-center">
              <h2 className="mb-4 text-4xl font-bold text-[#1a1a2e] md:text-5xl">
                {t.features.title} <span className="gradient-text">{t.features.titleHighlight}</span>
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">{t.features.subtitle}</p>
            </div>

            <div className="mx-auto max-w-7xl space-y-24">
              <div className="grid items-center gap-12 md:grid-cols-2">
                <div className="order-2 md:order-1">
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
                    <span className="text-lg font-bold text-white">01</span>
                  </div>
                  <h3 className="mb-4 text-3xl font-bold text-[#1a1a2e]">{t.features.feature1Title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{t.features.feature1Desc}</p>
                </div>
                <div className="order-1 md:order-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-12">
                    <div className="flex h-full items-center justify-center">
                      <Image
                        src="/images/feature01_interviews.svg"
                        alt="Interview Transcription"
                        width={280}
                        height={280}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid items-center gap-12 md:grid-cols-2">
                <div>
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-12">
                    <div className="flex h-full items-center justify-center">
                      <Image
                        src="/images/feature02_sales.svg"
                        alt="Sales Call Analysis"
                        width={280}
                        height={280}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
                    <span className="text-lg font-bold text-white">02</span>
                  </div>
                  <h3 className="mb-4 text-3xl font-bold text-[#1a1a2e]">{t.features.feature2Title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{t.features.feature2Desc}</p>
                </div>
              </div>

              <div className="grid items-center gap-12 md:grid-cols-2">
                <div className="order-2 md:order-1">
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
                    <span className="text-lg font-bold text-white">03</span>
                  </div>
                  <h3 className="mb-4 text-3xl font-bold text-[#1a1a2e]">{t.features.feature3Title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{t.features.feature3Desc}</p>
                </div>
                <div className="order-1 md:order-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-12">
                    <div className="flex h-full items-center justify-center">
                      <Image
                        src="/images/feature03_templates.svg"
                        alt="Summary Templates"
                        width={280}
                        height={280}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid items-center gap-12 md:grid-cols-2">
                <div>
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-12">
                    <div className="flex h-full items-center justify-center">
                      <Image
                        src="/images/feature04_action.svg"
                        alt="Action Items"
                        width={280}
                        height={280}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
                    <span className="text-lg font-bold text-white">04</span>
                  </div>
                  <h3 className="mb-4 text-3xl font-bold text-[#1a1a2e]">{t.features.feature4Title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{t.features.feature4Desc}</p>
                </div>
              </div>

              <div className="grid items-center gap-12 md:grid-cols-2">
                <div className="order-2 md:order-1">
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
                    <span className="text-lg font-bold text-white">05</span>
                  </div>
                  <h3 className="mb-4 text-3xl font-bold text-[#1a1a2e]">{t.features.feature5Title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{t.features.feature5Desc}</p>
                </div>
                <div className="order-1 md:order-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-12">
                    <div className="flex h-full items-center justify-center">
                      <Image
                        src="/images/feature05_globe.svg"
                        alt="Multi-language Support"
                        width={280}
                        height={280}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="testimonials" className="scroll-mt-28 relative overflow-hidden border-t border-primary/5 py-24">
          <div className="container mx-auto px-4">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-4xl font-bold text-[#1a1a2e] md:text-5xl">
                {t.testimonials.title} <span className="gradient-text">{t.testimonials.titleHighlight}</span>
              </h2>
              <p className="text-lg text-muted-foreground">{t.testimonials.subtitle}</p>
            </div>

            <div className="relative mx-auto max-w-7xl">
              <div className="testimonials-mask relative h-[600px] overflow-hidden">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div className="space-y-6">
                    <div className="animate-scroll-up space-y-6">
                      {[...testimonialsColumn1, ...testimonialsColumn1].map((testimonial, index) => (
                        <Card key={index} className="border-2 border-primary/10 bg-white/80 p-6 backdrop-blur-sm transition-all hover:border-primary/20 hover:shadow-lg">
                          <div className="mb-4 flex items-center gap-1">
                            {[...Array(testimonial.rating)].map((_, i) => (
                              <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          <p className="mb-6 leading-relaxed text-[#1a1a2e]">
                            "{testimonial.content}"
                          </p>
                          <div className="flex items-center gap-3">
                            <img
                              src={testimonial.avatar}
                              alt={testimonial.name}
                              className="h-12 w-12 rounded-full ring-2 ring-primary/10"
                            />
                            <div>
                              <p className="font-semibold text-[#1a1a2e]">{testimonial.name}</p>
                              <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <div className="hidden space-y-6 md:block">
                    <div className="animate-scroll-down space-y-6">
                      {[...testimonialsColumn2, ...testimonialsColumn2].map((testimonial, index) => (
                        <Card key={index} className="border-2 border-primary/10 bg-white/80 p-6 backdrop-blur-sm transition-all hover:border-primary/20 hover:shadow-lg">
                          <div className="mb-4 flex items-center gap-1">
                            {[...Array(testimonial.rating)].map((_, i) => (
                              <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          <p className="mb-6 leading-relaxed text-[#1a1a2e]">
                            "{testimonial.content}"
                          </p>
                          <div className="flex items-center gap-3">
                            <img
                              src={testimonial.avatar}
                              alt={testimonial.name}
                              className="h-12 w-12 rounded-full ring-2 ring-primary/10"
                            />
                            <div>
                              <p className="font-semibold text-[#1a1a2e]">{testimonial.name}</p>
                              <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <div className="hidden space-y-6 md:block">
                    <div className="animate-scroll-up space-y-6">
                      {[...testimonialsColumn3, ...testimonialsColumn3].map((testimonial, index) => (
                        <Card key={index} className="border-2 border-primary/10 bg-white/80 p-6 backdrop-blur-sm transition-all hover:border-primary/20 hover:shadow-lg">
                          <div className="mb-4 flex items-center gap-1">
                            {[...Array(testimonial.rating)].map((_, i) => (
                              <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          <p className="mb-6 leading-relaxed text-[#1a1a2e]">
                            "{testimonial.content}"
                          </p>
                          <div className="flex items-center gap-3">
                            <img
                              src={testimonial.avatar}
                              alt={testimonial.name}
                              className="h-12 w-12 rounded-full ring-2 ring-primary/10"
                            />
                            <div>
                              <p className="font-semibold text-[#1a1a2e]">{testimonial.name}</p>
                              <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-primary/5 bg-white/40 py-24 backdrop-blur-sm">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="mb-6 text-4xl font-bold text-[#1a1a2e] md:text-5xl">
                {t.cta.title}
              </h2>
              <p className="mb-10 text-xl text-muted-foreground">
                {t.cta.subtitle}
              </p>
              <Link href="/app/upload">
                <Button size="lg" className="h-14 bg-primary px-10 text-lg font-medium hover:bg-primary/90">
                  {t.cta.button}
                  <Play className="ml-2 h-6 w-6" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-primary/5 py-24 scroll-mt-20">
          <div className="container mx-auto px-4">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-4xl font-bold text-[#1a1a2e] md:text-5xl">
                {t.pricing.title}
              </h2>
              <p className="mb-8 text-lg text-muted-foreground">{t.pricing.subtitle}</p>

              <div className="inline-flex items-center gap-3 rounded-full bg-white/60 p-2 shadow-sm backdrop-blur-sm">
                <button
                  onClick={() => setIsYearly(false)}
                  className={`rounded-full px-6 py-2 text-sm font-medium transition-all ${
                    !isYearly
                      ? 'bg-[#1a1a2e] text-white shadow-md'
                      : 'text-muted-foreground hover:text-[#1a1a2e]'
                  }`}
                >
                  {t.pricing.monthly}
                </button>
                <button
                  onClick={() => setIsYearly(true)}
                  className={`relative rounded-full px-6 py-2 text-sm font-medium transition-all ${
                    isYearly
                      ? 'bg-[#1a1a2e] text-white shadow-md'
                      : 'text-muted-foreground hover:text-[#1a1a2e]'
                  }`}
                >
                  {t.pricing.yearly}
                  <Badge className="absolute -right-2 -top-2 bg-gradient-to-r from-pink-500 to-primary text-xs">
                    {t.pricing.yearlyDiscount}
                  </Badge>
                </button>
              </div>
            </div>

            <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
              <Card className="relative border-2 border-primary/10 bg-white/60 p-8 backdrop-blur-sm transition-all hover:shadow-lg">
                <div className="mb-6">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h3 className="text-2xl font-bold text-[#1a1a2e]">{t.pricing.freeTitle}</h3>
                  </div>
                  <p className="text-muted-foreground">{t.pricing.freeDesc}</p>
                </div>

                <div className="mb-8">
                  <div className="mb-2 text-3xl font-bold text-[#1a1a2e]">
                    {t.pricing.freePrice}
                  </div>
                  <div className="text-4xl font-bold text-[#1a1a2e]">$0</div>
                </div>

                <div className="mb-8 space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature1Free}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature2Free}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature3Free}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature4Free}</span>
                  </div>
                </div>

                <Button variant="outline" className="w-full border-2 text-[#1a1a2e]" disabled>
                  {t.pricing.currentPlan}
                </Button>
              </Card>

              <Card className="relative border-2 border-primary bg-white/80 p-8 shadow-xl backdrop-blur-sm transition-all hover:shadow-2xl">
                <Badge className="absolute -top-3 right-8 bg-gradient-to-r from-pink-500 to-primary">
                  {t.pricing.proRecommended}
                </Badge>

                <div className="mb-6">
                  <div className="mb-2 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" />
                    <h3 className="text-2xl font-bold text-[#1a1a2e]">{t.pricing.proTitle}</h3>
                  </div>
                  <p className="text-muted-foreground">{t.pricing.proDesc}</p>
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-[#1a1a2e]">
                      ${isYearly ? '8.66' : '12.99'}
                    </span>
                    <span className="text-muted-foreground">{t.pricing.perMonth}</span>
                  </div>
                  {isYearly && (
                    <p className="mt-1 text-sm text-primary">Billed annually at $103.88 (Save 33%)</p>
                  )}
                </div>

                <div className="mb-8 space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature1Pro}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature2Pro}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature3Pro}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature4Pro}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-[#1a1a2e]">{t.pricing.feature5Pro}</span>
                  </div>
                </div>

                <Button className="w-full bg-[#1a1a2e] text-white hover:bg-[#1a1a2e]/90">
                  {t.pricing.upgradeNow}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Card>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-28 relative overflow-hidden border-y border-primary/10 bg-gradient-to-br from-slate-50 via-blue-50/30 to-primary/5 py-24">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent opacity-60"></div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-blue-100/20 via-transparent to-transparent opacity-40"></div>

          <div className="container relative mx-auto px-4">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-4xl font-bold text-[#1a1a2e] md:text-5xl">
                {(t as any).faq?.title || 'Frequently Asked Questions'}
              </h2>
              <p className="text-lg text-muted-foreground">
                {(t as any).faq?.subtitle || 'Find answers to common questions about our audio transcription service'}
              </p>
            </div>

            <div className="mx-auto max-w-4xl space-y-6">
              {[
                { q: (t as any).faq?.q1 || 'How do I get started with transcription?', a: (t as any).faq?.a1 || 'Simply upload your audio or video file (MP3, WAV, M4A, MP4 formats supported), choose your preferred summary template, and click start. You\'ll receive accurate transcription and AI-powered summaries in minutes.' },
                { q: (t as any).faq?.q2 || 'What file formats are supported?', a: (t as any).faq?.a2 || 'We support all major audio and video formats including MP3, WAV, M4A, MP4, and more. Free users can upload files up to 60 minutes, while Pro users can upload files up to 180 minutes.' },
                { q: (t as any).faq?.q3 || 'Which languages are supported?', a: (t as any).faq?.a3 || 'Our service supports over 50 languages including English, Chinese, Spanish, French, German, Japanese, Korean, and many more. The AI can transcribe and translate content accurately across all supported languages.' },
                { q: (t as any).faq?.q4 || 'How accurate is the transcription?', a: (t as any).faq?.a4 || 'We use advanced Whisper and OpenAI technology to achieve 98% accuracy. The quality depends on audio clarity, but our AI handles various accents, background noise, and technical terminology effectively.' },
                { q: (t as any).faq?.q5 || 'What are the summary templates?', a: (t as any).faq?.a5 || 'We offer multiple AI-powered templates tailored for different use cases: Meeting Minutes, Study Notes, Sales Call Analysis, Interview Summaries, and Content Creation. Each template extracts relevant information and formats it appropriately.' },
                { q: (t as any).faq?.q6 || 'Can I use transcriptions commercially?', a: (t as any).faq?.a6 || 'Yes! Pro plan subscribers can use transcriptions and summaries for commercial purposes. Free plan users are limited to personal, non-commercial use only.' },
                { q: (t as any).faq?.q7 || 'What\'s included in the free plan?', a: (t as any).faq?.a7 || 'Free users get 3 uploads per month, up to 60 minutes per file, basic transcription, and access to standard summary templates. It\'s perfect for trying out the service or occasional use.' },
                { q: (t as any).faq?.q8 || 'How does priority processing work?', a: (t as any).faq?.a8 || 'Pro users enjoy priority processing, meaning their files are transcribed first during peak times. This ensures faster turnaround, typically completing in under 5 minutes regardless of system load.' },
              ].map((faq, index) => (
                <div
                  key={index}
                  className="group relative overflow-hidden rounded-2xl border-2 border-white/60 bg-white/80 p-8 shadow-sm backdrop-blur-md transition-all hover:border-primary/30 hover:bg-white/90 hover:shadow-xl"
                >
                  <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100"></div>

                  <div className="relative mb-4 flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1a1a2e] to-[#2a2a3e] text-lg font-bold text-white shadow-md transition-transform group-hover:scale-110">
                      {index + 1}
                    </div>
                    <h3 className="text-xl font-bold text-[#1a1a2e] transition-colors group-hover:text-primary">
                      {faq.q}
                    </h3>
                  </div>
                  <p className="relative pl-14 leading-relaxed text-muted-foreground">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
      <LanguageDetector currentLang={currentLang} onLanguageChange={handleLanguageChange} />

      {/* 修复：移除 ProcessingModal 的 onComplete 中的错误跳转逻辑 */}
      <ProcessingModal
        isOpen={isProcessing}
        onComplete={() => {
          // 不执行任何跳转操作
          // 实际的跳转由 handleTranscribe 中的 API 响应处理
          setIsProcessing(false);
        }}
      />

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        trigger="transcription"
      />
    </div>
  );
}
