#!/usr/bin/env python3
"""
测试演示脚本 - 使用模拟数据测试分析功能
"""
import json
import os
from datetime import datetime, timedelta
from ai_analyzer import AIAnalyzer

# 创建模拟的 Twitter 数据
def create_mock_data():
    """创建模拟的 Twitter 数据用于测试"""

    # 模拟的推文数据
    mock_tweets = [
        {
            'id': '1',
            'text': 'Just released a new AI coding assistant that helps developers write better code. The demand for AI dev tools is huge! #AI #coding',
            'created_at': (datetime.utcnow() - timedelta(days=2)).isoformat(),
            'like_count': 150,
            'retweet_count': 45,
            'reply_count': 20,
            'lang': 'en',
            'author': {
                'name': 'Tech Founder',
                'username': 'techfounder',
                'description': 'Building AI tools for developers'
            }
        },
        {
            'id': '2',
            'text': 'Spending 3 hours a day managing my social media posts. Wish there was an AI tool to help schedule and optimize content automatically.',
            'created_at': (datetime.utcnow() - timedelta(days=5)).isoformat(),
            'like_count': 89,
            'retweet_count': 23,
            'reply_count': 15,
            'lang': 'en',
            'author': {
                'name': 'Content Creator',
                'username': 'contentpro',
                'description': 'Content marketing specialist'
            }
        },
        {
            'id': '3',
            'text': 'AI-powered customer support is the future. We reduced response time by 80% with automated chatbots. Game changer for small businesses.',
            'created_at': (datetime.utcnow() - timedelta(days=1)).isoformat(),
            'like_count': 210,
            'retweet_count': 67,
            'reply_count': 34,
            'lang': 'en',
            'author': {
                'name': 'SaaS Founder',
                'username': 'saasbuilder',
                'description': 'Building B2B SaaS products'
            }
        },
        {
            'id': '4',
            'text': 'The amount of time I waste writing meeting summaries is insane. Someone please build an AI tool that auto-summarizes Zoom calls!',
            'created_at': (datetime.utcnow() - timedelta(days=3)).isoformat(),
            'like_count': 456,
            'retweet_count': 123,
            'reply_count': 89,
            'lang': 'en',
            'author': {
                'name': 'Product Manager',
                'username': 'pmlife',
                'description': 'PM at a tech company'
            }
        },
        {
            'id': '5',
            'text': 'Email overload is killing productivity. I get 200+ emails per day. Need an AI assistant to prioritize and draft responses.',
            'created_at': (datetime.utcnow() - timedelta(days=4)).isoformat(),
            'like_count': 178,
            'retweet_count': 56,
            'reply_count': 42,
            'lang': 'en',
            'author': {
                'name': 'Startup CEO',
                'username': 'startupceo',
                'description': 'CEO of a growing startup'
            }
        },
        {
            'id': '6',
            'text': 'Market research takes weeks. Imagine an AI tool that analyzes competitor data, user reviews, and trends in minutes. Would pay for that.',
            'created_at': (datetime.utcnow() - timedelta(days=6)).isoformat(),
            'like_count': 234,
            'retweet_count': 78,
            'reply_count': 45,
            'lang': 'en',
            'author': {
                'name': 'Growth Marketer',
                'username': 'growthguru',
                'description': 'Growth marketing consultant'
            }
        },
        {
            'id': '7',
            'text': 'Documentation is always outdated. We need AI that automatically updates docs based on code changes. This would save so much time.',
            'created_at': (datetime.utcnow() - timedelta(days=7)).isoformat(),
            'like_count': 167,
            'retweet_count': 43,
            'reply_count': 28,
            'lang': 'en',
            'author': {
                'name': 'Engineering Manager',
                'username': 'engmanager',
                'description': 'Managing engineering teams'
            }
        },
        {
            'id': '8',
            'text': 'Customer feedback is scattered across 10+ platforms. Building an AI tool to aggregate and analyze all feedback in one place.',
            'created_at': (datetime.utcnow() - timedelta(days=8)).isoformat(),
            'like_count': 145,
            'retweet_count': 39,
            'reply_count': 22,
            'lang': 'en',
            'author': {
                'name': 'UX Researcher',
                'username': 'uxresearch',
                'description': 'User experience researcher'
            }
        },
        {
            'id': '9',
            'text': 'SEO optimization is complex and time-consuming. An AI tool that suggests content improvements and tracks rankings would be amazing.',
            'created_at': (datetime.utcnow() - timedelta(days=9)).isoformat(),
            'like_count': 198,
            'retweet_count': 61,
            'reply_count': 35,
            'lang': 'en',
            'author': {
                'name': 'SEO Specialist',
                'username': 'seoexpert',
                'description': 'SEO consultant'
            }
        },
        {
            'id': '10',
            'text': 'Creating personalized sales outreach at scale is nearly impossible. AI that crafts custom messages based on prospect data = gold.',
            'created_at': (datetime.utcnow() - timedelta(days=10)).isoformat(),
            'like_count': 289,
            'retweet_count': 92,
            'reply_count': 58,
            'lang': 'en',
            'author': {
                'name': 'Sales Leader',
                'username': 'salesleader',
                'description': 'VP of Sales'
            }
        }
    ]

    # 构建完整的数据结构
    data = {
        'target_user': {
            'id': '12345',
            'name': '测试用户',
            'username': 'testuser',
            'description': 'AI enthusiast and product builder',
            'followers_count': 5000,
            'following_count': 150
        },
        'following_analyzed': 10,
        'total_tweets': len(mock_tweets),
        'collection_date': datetime.utcnow().isoformat(),
        'days_analyzed': 30,
        'tweets': mock_tweets
    }

    return data


def test_without_api():
    """测试不需要真实 API 的功能"""
    print("=" * 60)
    print("Twitter 分析工具 - 演示测试")
    print("=" * 60)
    print("\n注意：这是使用模拟数据的演示测试\n")

    # 1. 创建模拟数据
    print("步骤 1: 创建模拟数据...")
    mock_data = create_mock_data()
    print(f"✓ 创建了 {mock_data['total_tweets']} 条模拟推文")

    # 2. 保存模拟数据
    print("\n步骤 2: 保存数据到文件...")
    os.makedirs('data', exist_ok=True)
    data_file = 'data/mock_twitter_data.json'
    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump(mock_data, f, ensure_ascii=False, indent=2)
    print(f"✓ 数据已保存到: {data_file}")

    # 3. 显示数据摘要
    print("\n步骤 3: 数据摘要")
    print(f"  目标用户: {mock_data['target_user']['name']} (@{mock_data['target_user']['username']})")
    print(f"  分析用户数: {mock_data['following_analyzed']}")
    print(f"  收集推文数: {mock_data['total_tweets']}")
    print(f"  分析天数: {mock_data['days_analyzed']}")

    print("\n步骤 4: 显示热门推文示例")
    sorted_tweets = sorted(mock_data['tweets'], key=lambda x: x['like_count'], reverse=True)
    for i, tweet in enumerate(sorted_tweets[:3], 1):
        print(f"\n  推文 {i}:")
        print(f"  作者: {tweet['author']['name']} (@{tweet['author']['username']})")
        print(f"  内容: {tweet['text'][:100]}...")
        print(f"  互动: ❤️  {tweet['like_count']} | 🔄 {tweet['retweet_count']} | 💬 {tweet['reply_count']}")

    # 4. 测试 AI 分析（如果有 API key）
    print("\n" + "=" * 60)
    print("步骤 5: AI 分析")
    print("=" * 60)

    if os.getenv('ANTHROPIC_API_KEY'):
        print("\n检测到 ANTHROPIC_API_KEY，开始真实的 AI 分析...")
        try:
            analyzer = AIAnalyzer()
            analysis_result = analyzer.analyze_for_ai_opportunities(mock_data)

            if analysis_result.get('analysis'):
                print("✓ AI 分析完成！")

                # 生成报告
                report = analyzer.generate_detailed_report(mock_data, analysis_result)
                report_file = analyzer.save_report(report, 'mock_analysis_report.md')

                print(f"\n✓ 报告已生成: {report_file}")
                print("\n可以查看报告文件了解详细分析结果")
            else:
                print(f"❌ 分析失败: {analysis_result.get('error')}")
        except Exception as e:
            print(f"❌ 发生错误: {e}")
    else:
        print("\n⚠️  未检测到 ANTHROPIC_API_KEY")
        print("跳过 AI 分析步骤")
        print("\n如果要测试 AI 分析功能，请：")
        print("1. 在 .env 文件中设置 ANTHROPIC_API_KEY")
        print("2. 重新运行: python test_demo.py")

    print("\n" + "=" * 60)
    print("✓ 演示测试完成！")
    print("=" * 60)
    print(f"\n生成的文件:")
    print(f"  模拟数据: {data_file}")
    if os.path.exists('data/mock_analysis_report.md'):
        print(f"  分析报告: data/mock_analysis_report.md")

    print("\n提示:")
    print("- 这是使用模拟数据的演示")
    print("- 要使用真实 Twitter 数据，需要配置 TWITTER_BEARER_TOKEN")
    print("- 运行真实分析: python main.py <username>")


if __name__ == '__main__':
    # 加载环境变量
    from dotenv import load_dotenv
    load_dotenv()

    test_without_api()
