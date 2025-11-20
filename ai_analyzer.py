"""
AI 分析器 - 使用 Claude 分析 Twitter 数据并发现产品机会
"""
import os
import json
from typing import Dict, List
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()


class AIAnalyzer:
    """使用 Claude AI 分析 Twitter 数据"""

    def __init__(self):
        """初始化 Anthropic 客户端"""
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise ValueError("请在 .env 文件中设置 ANTHROPIC_API_KEY")

        self.client = Anthropic(api_key=api_key)
        print("✓ Claude AI 客户端初始化成功")

    def prepare_tweets_summary(self, tweets: List[Dict], max_tweets: int = 200) -> str:
        """
        准备推文摘要用于 AI 分析

        Args:
            tweets: 推文列表
            max_tweets: 最多包含多少条推文

        Returns:
            格式化的推文摘要
        """
        # 按点赞数排序，优先分析热门推文
        sorted_tweets = sorted(tweets, key=lambda x: x['like_count'], reverse=True)
        selected_tweets = sorted_tweets[:max_tweets]

        summary = []
        for i, tweet in enumerate(selected_tweets, 1):
            author = tweet['author']
            summary.append(
                f"推文 {i}:\n"
                f"作者: {author['name']} (@{author['username']})\n"
                f"内容: {tweet['text']}\n"
                f"互动: ❤️ {tweet['like_count']} | 🔄 {tweet['retweet_count']} | 💬 {tweet['reply_count']}\n"
                f"时间: {tweet['created_at']}\n"
            )

        return "\n".join(summary)

    def analyze_for_ai_opportunities(self, data: Dict) -> Dict:
        """
        分析推文数据，发现 AI 工具产品机会

        Args:
            data: Twitter 数据（包含推文列表）

        Returns:
            分析结果
        """
        print("\n开始 AI 分析...")

        tweets = data['tweets']
        if not tweets:
            return {
                'error': '没有推文数据可供分析',
                'recommendations': []
            }

        # 准备推文摘要
        tweets_summary = self.prepare_tweets_summary(tweets)

        # 构建分析提示
        prompt = f"""你是一位资深的产品经理和技术趋势分析师。请分析以下 Twitter 推文数据，发现值得开发的 AI 工具产品机会。

数据概况:
- 分析对象: {data['target_user']['name']} (@{data['target_user']['username']}) 关注的用户
- 关注用户数: {data['following_analyzed']}
- 推文总数: {data['total_tweets']}
- 分析时间范围: 最近 {data['days_analyzed']} 天

推文内容:
{tweets_summary}

请从以下几个维度进行深度分析:

1. **热门话题和趋势**
   - 识别当前最热门的讨论话题
   - 分析技术趋势和方向
   - 发现反复出现的痛点和需求

2. **用户痛点分析**
   - 用户在抱怨什么问题？
   - 什么工作流程需要优化？
   - 什么任务重复且耗时？

3. **AI 工具产品机会**
   - 基于上述分析，提出 5-10 个具体的 AI 工具产品想法
   - 每个想法包括:
     * 产品名称和一句话描述
     * 解决的核心问题
     * 目标用户群体
     * 核心功能（3-5 个）
     * 技术可行性评估
     * 市场潜力评估（1-5 分）
     * 开发难度评估（1-5 分）

4. **优先级推荐**
   - 根据市场潜力、技术可行性、开发成本等因素
   - 推荐最值得优先开发的 3 个产品

5. **实施建议**
   - MVP（最小可行产品）应该包含哪些功能
   - 技术栈建议
   - 预期开发周期

请用中文输出详细的分析报告，使用 Markdown 格式，要具体、实用、有洞察力。"""

        try:
            # 调用 Claude API
            print("正在调用 Claude AI 进行分析（这可能需要几分钟）...")

            message = self.client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=8000,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )

            analysis = message.content[0].text

            print("✓ AI 分析完成")

            return {
                'analysis': analysis,
                'model': message.model,
                'tokens_used': {
                    'input': message.usage.input_tokens,
                    'output': message.usage.output_tokens
                },
                'analyzed_tweets_count': len(tweets)
            }

        except Exception as e:
            print(f"AI 分析失败: {e}")
            return {
                'error': str(e),
                'analysis': None
            }

    def generate_detailed_report(self, data: Dict, analysis_result: Dict) -> str:
        """
        生成完整的分析报告

        Args:
            data: Twitter 数据
            analysis_result: AI 分析结果

        Returns:
            Markdown 格式的报告
        """
        report_parts = []

        # 标题和概述
        report_parts.append(f"# Twitter 关注用户分析报告\n")
        report_parts.append(f"**分析对象**: {data['target_user']['name']} (@{data['target_user']['username']})\n")
        report_parts.append(f"**生成时间**: {data['collection_date']}\n")
        report_parts.append(f"**分析范围**: 最近 {data['days_analyzed']} 天\n")
        report_parts.append("\n---\n\n")

        # 数据统计
        report_parts.append("## 📊 数据统计\n")
        report_parts.append(f"- **关注用户数**: {data['target_user']['following_count']}\n")
        report_parts.append(f"- **分析用户数**: {data['following_analyzed']}\n")
        report_parts.append(f"- **收集推文数**: {data['total_tweets']}\n")

        if analysis_result.get('tokens_used'):
            report_parts.append(f"- **AI 分析令牌**: {analysis_result['tokens_used']['input']} 输入 + {analysis_result['tokens_used']['output']} 输出\n")

        report_parts.append("\n---\n\n")

        # AI 分析结果
        if analysis_result.get('analysis'):
            report_parts.append("## 🤖 AI 分析结果\n\n")
            report_parts.append(analysis_result['analysis'])
        else:
            report_parts.append("## ⚠️ 分析错误\n\n")
            report_parts.append(f"分析过程中出现错误: {analysis_result.get('error', '未知错误')}\n")

        report_parts.append("\n\n---\n\n")

        # 数据来源
        report_parts.append("## 📝 数据来源\n\n")
        report_parts.append("本报告基于以下用户的推文分析:\n\n")

        # 统计每个作者的推文数
        author_stats = {}
        for tweet in data['tweets']:
            username = tweet['author']['username']
            if username not in author_stats:
                author_stats[username] = {
                    'name': tweet['author']['name'],
                    'username': username,
                    'count': 0
                }
            author_stats[username]['count'] += 1

        # 按推文数排序
        sorted_authors = sorted(author_stats.values(), key=lambda x: x['count'], reverse=True)

        for i, author in enumerate(sorted_authors[:20], 1):  # 只显示前 20 个最活跃的
            report_parts.append(f"{i}. **{author['name']}** (@{author['username']}) - {author['count']} 条推文\n")

        if len(sorted_authors) > 20:
            report_parts.append(f"\n...以及其他 {len(sorted_authors) - 20} 位用户\n")

        return "".join(report_parts)

    def save_report(self, report: str, filename: str = None):
        """
        保存分析报告

        Args:
            report: 报告内容
            filename: 文件名（可选）
        """
        if not filename:
            from datetime import datetime
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"analysis_report_{timestamp}.md"

        # 确保 data 目录存在
        os.makedirs('data', exist_ok=True)
        filepath = os.path.join('data', filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(report)

        print(f"\n✓ 分析报告已保存到: {filepath}")
        return filepath
