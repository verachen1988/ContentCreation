#!/bin/bash
# 快速设置脚本

echo "========================================="
echo "Twitter 关注用户分析工具 - 安装向导"
echo "========================================="
echo ""

# 检查 Python 版本
echo "检查 Python 版本..."
python3 --version
if [ $? -ne 0 ]; then
    echo "❌ 错误: 未找到 Python 3"
    echo "请先安装 Python 3.8 或更高版本"
    exit 1
fi
echo "✓ Python 已安装"
echo ""

# 安装依赖
echo "安装 Python 依赖..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi
echo "✓ 依赖安装成功"
echo ""

# 创建 .env 文件
if [ ! -f .env ]; then
    echo "创建 .env 配置文件..."
    cp .env.example .env
    echo "✓ .env 文件已创建"
    echo ""
    echo "⚠️  重要: 请编辑 .env 文件，填入你的 API 密钥："
    echo "   - TWITTER_BEARER_TOKEN"
    echo "   - ANTHROPIC_API_KEY"
    echo ""
else
    echo "✓ .env 文件已存在"
    echo ""
fi

# 创建 data 目录
mkdir -p data
echo "✓ data 目录已创建"
echo ""

# 设置执行权限
chmod +x main.py
echo "✓ 已设置执行权限"
echo ""

echo "========================================="
echo "✓ 安装完成！"
echo "========================================="
echo ""
echo "下一步："
echo "1. 编辑 .env 文件，填入你的 API 密钥"
echo "2. 运行分析: python main.py <twitter_username>"
echo ""
echo "获取帮助: python main.py --help"
echo "查看文档: cat README.md"
echo ""
