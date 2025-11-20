#!/usr/bin/env python3
"""
Twitter 关注用户分析工具
自动收集并分析指定 Twitter 用户关注的人的推文，发现 AI 工具产品机会
"""
import argparse
import sys
import json
from twitter_analyzer import TwitterAnalyzer
from ai_analyzer import AIAnalyzer


def main():
    parser = argparse.ArgumentParser(
        description='分析 Twitter 用户关注的人的推文，发现 AI 产品机会',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 分析 @elonmusk 关注的用户（默认参数）
  python main.py elonmusk

  # 自定义参数
  python main.py sama --days 7 --max-following 50 --max-tweets 30

  # 仅从已有数据文件生成分析报告
  python main.py --analyze-only data/twitter_data_sama_20240101_120000.json
        """
    )

    parser.add_argument(
        'username',
        nargs='?',
        help='要分析的 Twitter 用户名（不含 @）'
    )

    parser.add_argument(
        '--days',
        type=int,
        default=30,
        help='分析最近多少天的推文（默认: 30）'
    )

    parser.add_argument(
        '--max-following',
        type=int,
        default=100,
        help='最多分析多少个关注用户（默认: 100）'
    )

    parser.add_argument(
        '--max-tweets',
        type=int,
        default=50,
        help='每个用户最多获取多少条推文（默认: 50）'
    )

    parser.add_argument(
        '--skip-analysis',
        action='store_true',
        help='仅收集数据，跳过 AI 分析'
    )

    parser.add_argument(
        '--analyze-only',
        type=str,
        metavar='DATA_FILE',
        help='仅对已有的数据文件进行 AI 分析'
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Twitter 关注用户分析工具 - AI 产品机会发现")
    print("=" * 60)

    # 如果是仅分析模式
    if args.analyze_only:
        try:
            print(f"\n加载数据文件: {args.analyze_only}")
            with open(args.analyze_only, 'r', encoding='utf-8') as f:
                data = json.load(f)

            print("✓ 数据加载成功")

            # AI 分析
            ai_analyzer = AIAnalyzer()
            analysis_result = ai_analyzer.analyze_for_ai_opportunities(data)

            # 生成报告
            report = ai_analyzer.generate_detailed_report(data, analysis_result)
            report_file = ai_analyzer.save_report(report)

            print("\n" + "=" * 60)
            print("✓ 分析完成！")
            print(f"报告文件: {report_file}")
            print("=" * 60)

        except FileNotFoundError:
            print(f"❌ 错误: 找不到文件 {args.analyze_only}")
            sys.exit(1)
        except json.JSONDecodeError:
            print(f"❌ 错误: 文件格式不正确")
            sys.exit(1)
        except Exception as e:
            print(f"❌ 错误: {e}")
            sys.exit(1)

        return

    # 正常模式需要 username
    if not args.username:
        parser.print_help()
        sys.exit(1)

    try:
        # 1. 收集 Twitter 数据
        print("\n" + "=" * 60)
        print("第 1 步: 收集 Twitter 数据")
        print("=" * 60)

        twitter_analyzer = TwitterAnalyzer()
        data = twitter_analyzer.collect_following_tweets(
            username=args.username,
            days=args.days,
            max_following=args.max_following,
            max_tweets_per_user=args.max_tweets
        )

        if not data:
            print("❌ 数据收集失败")
            sys.exit(1)

        # 保存原始数据
        data_file = twitter_analyzer.save_data(data)

        # 如果跳过分析，直接结束
        if args.skip_analysis:
            print("\n" + "=" * 60)
            print("✓ 数据收集完成（已跳过 AI 分析）")
            print(f"数据文件: {data_file}")
            print("\n提示: 稍后可以使用以下命令进行分析:")
            print(f"  python main.py --analyze-only {data_file}")
            print("=" * 60)
            return

        # 2. AI 分析
        print("\n" + "=" * 60)
        print("第 2 步: AI 分析和产品机会发现")
        print("=" * 60)

        ai_analyzer = AIAnalyzer()
        analysis_result = ai_analyzer.analyze_for_ai_opportunities(data)

        # 3. 生成报告
        print("\n" + "=" * 60)
        print("第 3 步: 生成分析报告")
        print("=" * 60)

        report = ai_analyzer.generate_detailed_report(data, analysis_result)
        report_file = ai_analyzer.save_report(report)

        # 完成
        print("\n" + "=" * 60)
        print("✓ 全部完成！")
        print("=" * 60)
        print(f"\n生成的文件:")
        print(f"  数据文件: {data_file}")
        print(f"  报告文件: {report_file}")
        print("\n提示: 可以直接查看报告文件了解分析结果")
        print("=" * 60)

    except KeyboardInterrupt:
        print("\n\n用户中断操作")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
