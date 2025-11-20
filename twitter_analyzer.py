"""
Twitter 分析器 - 用于获取和分析 Twitter 数据
"""
import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import tweepy
from dotenv import load_dotenv

load_dotenv()


class TwitterAnalyzer:
    """Twitter 数据获取和分析类"""

    def __init__(self):
        """初始化 Twitter API 客户端"""
        bearer_token = os.getenv('TWITTER_BEARER_TOKEN')
        if not bearer_token:
            raise ValueError("请在 .env 文件中设置 TWITTER_BEARER_TOKEN")

        self.client = tweepy.Client(bearer_token=bearer_token)
        print("✓ Twitter API 客户端初始化成功")

    def get_user_by_username(self, username: str) -> Optional[Dict]:
        """
        通过用户名获取用户信息

        Args:
            username: Twitter 用户名（不含 @）

        Returns:
            用户信息字典
        """
        try:
            user = self.client.get_user(
                username=username,
                user_fields=['id', 'name', 'username', 'description', 'public_metrics']
            )
            if user.data:
                return {
                    'id': user.data.id,
                    'name': user.data.name,
                    'username': user.data.username,
                    'description': user.data.description,
                    'followers_count': user.data.public_metrics['followers_count'],
                    'following_count': user.data.public_metrics['following_count']
                }
            return None
        except Exception as e:
            print(f"获取用户信息失败: {e}")
            return None

    def get_following_list(self, user_id: str, max_results: int = 1000) -> List[Dict]:
        """
        获取用户关注的人列表

        Args:
            user_id: 用户 ID
            max_results: 最多获取的关注数量

        Returns:
            关注用户列表
        """
        following = []
        try:
            print(f"正在获取关注列表...")

            # Twitter API v2 每次最多返回 1000 个结果
            paginator = tweepy.Paginator(
                self.client.get_users_following,
                id=user_id,
                max_results=min(max_results, 1000),
                user_fields=['id', 'name', 'username', 'description', 'public_metrics']
            )

            count = 0
            for response in paginator:
                if response.data:
                    for user in response.data:
                        following.append({
                            'id': user.id,
                            'name': user.name,
                            'username': user.username,
                            'description': user.description,
                            'followers_count': user.public_metrics['followers_count']
                        })
                        count += 1
                        if count >= max_results:
                            break

                if count >= max_results:
                    break

            print(f"✓ 获取到 {len(following)} 个关注用户")
            return following

        except Exception as e:
            print(f"获取关注列表失败: {e}")
            return following

    def get_user_recent_tweets(self, user_id: str, days: int = 30, max_tweets: int = 100) -> List[Dict]:
        """
        获取用户最近的推文

        Args:
            user_id: 用户 ID
            days: 获取最近多少天的推文
            max_tweets: 最多获取多少条推文

        Returns:
            推文列表
        """
        tweets = []
        try:
            # 计算起始时间
            start_time = datetime.utcnow() - timedelta(days=days)

            # 获取推文
            response = self.client.get_users_tweets(
                id=user_id,
                max_results=min(max_tweets, 100),  # API 限制每次最多 100 条
                start_time=start_time,
                tweet_fields=['id', 'text', 'created_at', 'public_metrics', 'lang'],
                exclude=['retweets', 'replies']  # 排除转发和回复
            )

            if response.data:
                for tweet in response.data:
                    tweets.append({
                        'id': tweet.id,
                        'text': tweet.text,
                        'created_at': tweet.created_at.isoformat(),
                        'like_count': tweet.public_metrics['like_count'],
                        'retweet_count': tweet.public_metrics['retweet_count'],
                        'reply_count': tweet.public_metrics['reply_count'],
                        'lang': tweet.lang
                    })

            return tweets

        except Exception as e:
            print(f"获取推文失败 (用户 ID: {user_id}): {e}")
            return tweets

    def collect_following_tweets(
        self,
        username: str,
        days: int = 30,
        max_following: int = 100,
        max_tweets_per_user: int = 50
    ) -> Dict:
        """
        收集指定用户关注的人的最近推文

        Args:
            username: Twitter 用户名
            days: 获取最近多少天的推文
            max_following: 最多分析多少个关注用户
            max_tweets_per_user: 每个用户最多获取多少条推文

        Returns:
            包含所有数据的字典
        """
        print(f"\n开始分析 @{username} 的关注用户...")

        # 1. 获取目标用户信息
        user_info = self.get_user_by_username(username)
        if not user_info:
            print(f"❌ 无法找到用户 @{username}")
            return None

        print(f"✓ 找到用户: {user_info['name']} (@{user_info['username']})")
        print(f"  关注数: {user_info['following_count']}")

        # 2. 获取关注列表
        following_list = self.get_following_list(user_info['id'], max_following)
        if not following_list:
            print("❌ 无法获取关注列表")
            return None

        # 3. 获取每个关注用户的推文
        all_tweets = []
        print(f"\n开始收集推文（最近 {days} 天）...")

        for i, followed_user in enumerate(following_list, 1):
            print(f"[{i}/{len(following_list)}] 获取 @{followed_user['username']} 的推文...")

            tweets = self.get_user_recent_tweets(
                followed_user['id'],
                days=days,
                max_tweets=max_tweets_per_user
            )

            if tweets:
                for tweet in tweets:
                    tweet['author'] = {
                        'name': followed_user['name'],
                        'username': followed_user['username'],
                        'description': followed_user['description']
                    }
                    all_tweets.append(tweet)

                print(f"  ✓ 获取到 {len(tweets)} 条推文")
            else:
                print(f"  - 该用户在最近 {days} 天没有推文")

        result = {
            'target_user': user_info,
            'following_analyzed': len(following_list),
            'total_tweets': len(all_tweets),
            'collection_date': datetime.utcnow().isoformat(),
            'days_analyzed': days,
            'tweets': all_tweets
        }

        print(f"\n✓ 数据收集完成！")
        print(f"  分析了 {len(following_list)} 个关注用户")
        print(f"  收集了 {len(all_tweets)} 条推文")

        return result

    def save_data(self, data: Dict, filename: str = None):
        """
        保存数据到 JSON 文件

        Args:
            data: 要保存的数据
            filename: 文件名（可选）
        """
        if not filename:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            username = data['target_user']['username']
            filename = f"twitter_data_{username}_{timestamp}.json"

        # 确保 data 目录存在
        os.makedirs('data', exist_ok=True)
        filepath = os.path.join('data', filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"\n✓ 数据已保存到: {filepath}")
        return filepath
