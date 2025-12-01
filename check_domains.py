#!/usr/bin/env python3
"""
Domain availability checker script
"""
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

domains = [
    "nanobananoproai.com",
    "nano-banana-pro-ai.com",
    "nano-banana-proai.com",
    "nanobanana-proai.com",
    "nanobana-proai.com",
    "nanoproai.com",
    "bananoproai.com",
    "nanobananaai.com",
    "nanobanaai.com",
    "nbproai.com",
    "nbpai.com",
    "nanobanpro.com",
    "nanobananapro.com",
    "proainanobana.com",
    "ainanobana.com",
    "nanobananaproai-app.com",
    "nanobananaproai-io.com",
    "nanobananaproai-tech.com",
    "nanobananaproai-lab.com",
    "nanobananaproai-hub.com",
    "getnanobananproai.com",
    "mynanobananproai.com",
    "thenanobananproai.com",
    "nanobanan-ai.com",
    "nano-bana-ai.com",
    "nanobanaproai.com",
    "nanobproai.com",
    "nanobanai.com",
    "banaproai.com",
    "nbanaproai.com",
    "nanob-proai.com",
    "nano-proai.com",
    "banana-proai.com",
    "nanobanana-ai.com",
    "nanoproai-app.com",
    "nanoproai-io.com",
    "nanobana.com",
    "pronanobana.com",
    "aipronanobana.com",
    "nanobananapro-ai.com",
    "nanobanpro-ai.com",
    "nano4banana.com",
    "nanob4nana.com",
    "nanobanana2024.com",
    "nanobananaproai2024.com",
    "nanobananaproaiapp.com",
    "nanobananaproaitech.com",
    "nanobanproai.com",
    "nanobanapro.com",
    "nanobananaai-pro.com",
]

def check_domain_dns(domain):
    """Check if domain resolves via DNS"""
    try:
        socket.gethostbyname(domain)
        return True  # Domain resolves, likely registered
    except socket.gaierror:
        return False  # Domain doesn't resolve, might be available

def check_domain_availability(domain):
    """
    Check if a domain is available
    Returns: (domain, is_likely_available, status_message)
    """
    try:
        # Method 1: Check DNS resolution
        resolves = check_domain_dns(domain)

        if resolves:
            return (domain, False, "已注册 (DNS解析成功)")
        else:
            # Domain doesn't resolve - likely available
            return (domain, True, "可能可用 (DNS未解析)")

    except Exception as e:
        return (domain, None, f"检查失败: {str(e)}")

def main():
    print("开始检查域名可用性...")
    print("=" * 80)

    available_domains = []
    registered_domains = []
    failed_checks = []

    # Use ThreadPoolExecutor for concurrent checks
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_domain = {executor.submit(check_domain_availability, domain): domain
                           for domain in domains}

        for i, future in enumerate(as_completed(future_to_domain), 1):
            domain, is_available, message = future.result()

            print(f"[{i}/{len(domains)}] {domain}: {message}")

            if is_available is True:
                available_domains.append(domain)
            elif is_available is False:
                registered_domains.append(domain)
            else:
                failed_checks.append(domain)

            # Small delay to be respectful
            time.sleep(0.1)

    print("\n" + "=" * 80)
    print("检查完成！")
    print("=" * 80)
    print(f"\n✓ 可能可用的域名 ({len(available_domains)} 个):")
    for domain in available_domains:
        print(f"  • {domain}")

    print(f"\n✗ 已注册的域名 ({len(registered_domains)} 个):")
    for domain in registered_domains[:10]:  # Show first 10
        print(f"  • {domain}")
    if len(registered_domains) > 10:
        print(f"  ... 还有 {len(registered_domains) - 10} 个已注册域名")

    if failed_checks:
        print(f"\n? 检查失败的域名 ({len(failed_checks)} 个):")
        for domain in failed_checks:
            print(f"  • {domain}")

    return available_domains

if __name__ == "__main__":
    available = main()
    if available:
        print(f"\n🎉 找到 {len(available)} 个可能可用的域名！")
    else:
        print("\n⚠️  没有找到可用的域名，需要生成更多变体...")
