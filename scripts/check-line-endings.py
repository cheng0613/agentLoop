#!/usr/bin/env python3
"""Check that tracked text files use LF, not CRLF.

为什么需要这个检查
----------------------------------------------------------------
仓库在 Windows 上开发时，编辑器（或某些 Python 脚本的默认 newline 模式）
会把文件静默转成 CRLF。这类改动不会让代码「看起来」出错，却会在别处
引发难查的失败：

  - web/syntax_test.go 这类精确字符串断言：测试用 "\\n" 匹配源码，
    命中 CRLF 时 strings.Contains 失败，报「boot must preload...」，
    完全看不出根因是换行符。
  - Makefile、*.sh 在 Linux / CI 上直接报错：
    "set: pipefail: invalid option name"。
  - shell 脚本在容器里执行失败，错误信息指向行号而非换行符。

历史上已经踩过两次（48 个 .sh 文件、4 个被编辑过的源文件），所以做成
可重复执行的检查。

判定规则
----------------------------------------------------------------
按扩展名放行二进制文件，其余按文本读取：
  - 出现 "\\r\\n"  → 判定为 CRLF，报错
  - 只有零散的 "\\r"（老式 Mac 换行）→ 也报错

用法：
    python3 scripts/check-line-endings.py            # 检查 git 跟踪的文件
    python3 scripts/check-line-endings.py --all      # 连同未跟踪文件一起查
    python3 scripts/check-line-endings.py a.js b.sh  # 只查指定文件

退出码：0 全部通过，1 发现 CRLF，2 无法读取。

修复方式：
    python3 scripts/check-line-endings.py --fix      # 就地转回 LF
"""

from __future__ import annotations

import argparse
import subprocess
import sys

# Windows 控制台默认 GBK，打印 ✓ 会抛 UnicodeEncodeError。
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 二进制或无需检查的扩展名。
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".gz", ".tar", ".bz2", ".7z",
    ".pdf", ".jar", ".wasm", ".mp4", ".mp3",
    # 图形与数据文件不参与构建，也不做精确字符串匹配，保持原样即可。
    ".svg", ".ndjson", ".bin", ".min",
}

# 明确允许 CRLF 的文件（Windows 专用脚本等）。当前没有，保留扩展点。
# vendored 的第三方资源保持原样：转换它们只会制造与上游无关的巨大 diff，
# 而这些文件也不参与 Go 构建或精确字符串断言。
VENDORED_PREFIXES = (
    "web/vscode-web/",
    "web/monaco/",
    "web/vendor/",
    "chatbot/src/assets/provider-logos/",
    "docs/assets/",
)

ALLOW_CRLF = set()


def tracked_files(include_untracked: bool) -> list[Path]:
    """git 跟踪的文件；include_untracked 时连同未忽略的新文件一起。"""
    args = ["git", "ls-files", "-z"]
    if include_untracked:
        args = ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    try:
        out = subprocess.check_output(args, cwd=ROOT)
    except subprocess.CalledProcessError as err:
        print(f"✗ 无法列出 git 文件：{err}", file=sys.stderr)
        raise SystemExit(2)
    files = []
    for raw in out.decode("utf-8", errors="replace").split("\0"):
        if not raw.strip():
            continue
        path = ROOT / raw
        if path.is_file():
            files.append(path)
    return files


def has_crlf(path: Path) -> tuple[bool, str]:
    """返回 (是否为 CRLF, 附加说明)。读不出来时抛 OSError。"""
    data = path.read_bytes()
    if b"\r\n" in data:
        return True, "CRLF"
    # 零散 \r：老式 Mac 换行，同样不是我们想要的。
    stripped = data.replace(b"\r\n", b"")
    if b"\r" in stripped:
        return True, "单独的 CR"
    return False, ""


def convert_to_lf(path: Path) -> None:
    data = path.read_bytes()
    path.write_bytes(data.replace(b"\r\n", b"\n").replace(b"\r", b"\n"))


def main() -> int:
    parser = argparse.ArgumentParser(description="检查仓库内文本文件是否使用了 LF 换行。")
    parser.add_argument("files", nargs="*", help="只检查这些文件；省略则用 git 列表")
    parser.add_argument("--all", action="store_true", help="连同未跟踪文件一起检查")
    parser.add_argument("--fix", action="store_true", help="就地把 CRLF 文件转回 LF")
    args = parser.parse_args()

    if args.files:
        targets = [Path(f).resolve() for f in args.files]
    else:
        targets = tracked_files(args.all)

    problems: list[tuple[Path, str]] = []
    for path in targets:
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        name = path.name
        if name in ALLOW_CRLF:
            continue
        try:
            rel = path.relative_to(ROOT).as_posix()
        except ValueError:
            rel = path.as_posix()
        if rel.startswith(VENDORED_PREFIXES):
            continue
        try:
            bad, detail = has_crlf(path)
        except OSError as err:
            print(f"✗ 无法读取 {path}：{err}", file=sys.stderr)
            return 2
        if bad:
            problems.append((path, detail))

    if not problems:
        print(f"✓ 换行符检查通过（{len(targets)} 个文件均为 LF）")
        return 0

    if args.fix:
        for path, _ in problems:
            convert_to_lf(path)
        print(f"✓ 已把 {len(problems)} 个文件转回 LF：")
        for path, _ in problems:
            try:
                shown = path.relative_to(ROOT)
            except ValueError:
                shown = path
            print(f"    {shown}")
        return 0

    print(f"✗ 发现 {len(problems)} 个文件使用了 CRLF：")
    for path, detail in problems:
        try:
            shown = path.relative_to(ROOT)
        except ValueError:
            shown = path
        print(f"    {shown}  ({detail})")
    print()
    print("CRLF 会让精确字符串断言失败，也会让 Makefile 与 shell 脚本在 Linux/CI 上报错。")
    print("修复：python3 scripts/check-line-endings.py --fix")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
