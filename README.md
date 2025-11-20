# Twitter 关注用户分析工具

一个强大的自动化工具，用于分析指定 Twitter 用户关注的人的最近推文，并使用 AI 发现值得开发的产品机会。

## 功能特点

- ✅ 自动获取指定 Twitter 用户的关注列表
- ✅ 批量收集关注用户最近 30 天（可配置）的推文
- ✅ 使用 Claude AI 深度分析推文内容
- ✅ 发现热门话题、用户痛点和产品机会
- ✅ 生成详细的分析报告（Markdown 格式）
- ✅ 推荐最值得开发的 AI 工具产品

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置 API 密钥

复制 `.env.example` 为 `.env`，然后填入你的 API 密钥：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Twitter API 配置
TWITTER_BEARER_TOKEN=你的_Twitter_Bearer_Token

# Claude API 配置
ANTHROPIC_API_KEY=你的_Anthropic_API_Key
```

#### 如何获取 API 密钥

**Twitter API:**
1. 访问 [Twitter Developer Portal](https://developer.twitter.com/)
2. 创建一个新的 App
3. 在 "Keys and tokens" 页面生成 Bearer Token
4. 注意：需要申请 Twitter API v2 访问权限（免费套餐即可）

**Anthropic Claude API:**
1. 访问 [Anthropic Console](https://console.anthropic.com/)
2. 注册账号并创建 API Key
3. 复制 API Key

### 3. 运行分析

基本用法：

```bash
# 分析指定用户（例如 elonmusk）
python main.py elonmusk
```

自定义参数：

```bash
# 分析最近 7 天，最多 50 个关注用户
python main.py sama --days 7 --max-following 50 --max-tweets 30
```

仅收集数据，稍后再分析：

```bash
# 先收集数据
python main.py elonmusk --skip-analysis

# 稍后对数据进行分析
python main.py --analyze-only data/twitter_data_elonmusk_20240315_120000.json
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `username` | 要分析的 Twitter 用户名（不含 @） | 必需 |
| `--days` | 分析最近多少天的推文 | 30 |
| `--max-following` | 最多分析多少个关注用户 | 100 |
| `--max-tweets` | 每个用户最多获取多少条推文 | 50 |
| `--skip-analysis` | 仅收集数据，跳过 AI 分析 | False |
| `--analyze-only` | 仅对已有数据文件进行分析 | None |

## 输出文件

运行后会在 `data/` 目录下生成两个文件：

1. **数据文件** (`twitter_data_*.json`)：包含收集的所有推文原始数据
2. **分析报告** (`analysis_report_*.md`)：AI 生成的详细分析报告

## 分析报告内容

生成的报告包含：

1. **数据统计** - 分析范围和数据量
2. **热门话题和趋势** - 当前讨论最多的话题
3. **用户痛点分析** - 发现的问题和需求
4. **AI 工具产品机会** - 5-10 个具体的产品想法，包括：
   - 产品描述
   - 解决的问题
   - 目标用户
   - 核心功能
   - 技术可行性
   - 市场潜力
5. **优先级推荐** - 最值得优先开发的 3 个产品
6. **实施建议** - MVP 功能、技术栈、开发周期

## 项目结构

```
ContentCreation/
├── main.py                 # 主程序
├── twitter_analyzer.py     # Twitter API 集成
├── ai_analyzer.py          # AI 分析模块
├── requirements.txt        # Python 依赖
├── .env.example           # 环境变量模板
├── .env                   # 环境变量（需自己创建）
├── .gitignore            # Git 忽略文件
├── README.md             # 本文件
└── data/                 # 数据和报告输出目录
    ├── twitter_data_*.json
    └── analysis_report_*.md
```

## API 使用限制

**Twitter API v2 免费套餐限制：**
- 每月 10,000 条推文读取
- 每月 50 个用户查询
- 建议合理控制 `--max-following` 和 `--max-tweets` 参数

**Anthropic Claude API：**
- 按 token 计费
- 每次分析大约使用 5,000-15,000 tokens
- 成本约 $0.05-0.15 每次分析

## 使用建议

1. **选择合适的分析对象**：选择在你关注领域有影响力的 Twitter 用户
2. **控制数据量**：开始时使用较小的参数（如 `--max-following 20`）测试
3. **定期分析**：每周或每月运行一次，跟踪趋势变化
4. **多角度分析**：分析多个不同领域的用户，发现交叉机会

## 示例

分析 AI 领域的机会：

```bash
# 分析 Sam Altman 的关注用户
python main.py sama --days 14 --max-following 80

# 分析 Anthropic CEO
python main.py danielgross --days 7 --max-following 50
```

## 故障排除

**问题：Twitter API 认证失败**
- 检查 `.env` 文件中的 `TWITTER_BEARER_TOKEN` 是否正确
- 确认 Twitter Developer 账号已激活

**问题：获取推文数量很少**
- Twitter 免费 API 只能获取用户最近 7 天的推文
- 某些用户可能推文频率较低
- 尝试增加 `--max-following` 参数

**问题：AI 分析失败**
- 检查 `ANTHROPIC_API_KEY` 是否正确
- 确认 API 账户有足够的余额

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可

MIT License

---

**注意**：使用本工具请遵守 Twitter 和 Anthropic 的服务条款，仅用于个人研究和学习目的。
