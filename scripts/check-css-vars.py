#!/usr/bin/env python3
"""Check CSS custom properties for defects that silently drop colors.

CSS 自定义属性出错时不会报错，只会让颜色变成空值，界面上表现为「某处
突然没颜色了」。排查这类问题的成本很高，所以这里把三种已知缺陷做成
可重复执行的检查：

  1. 自引用       --x: var(--x)          —— 解析为空
  2. 循环引用     --a -> --b -> --a      —— 环上所有属性都解析为空
  3. 未定义引用   var(--x) 但没人声明 --x —— 取到 fallback 或空

三者共同的后果是 var(--x) 拿到空值，因此一律按错误处理。

用法：
    python3 scripts/check-css-vars.py            # 检查 web/ 下全部 CSS
    python3 scripts/check-css-vars.py --verbose  # 同时列出已定义的变量数
    python3 scripts/check-css-vars.py path/to/a.css path/to/b.css

退出码：0 全部通过，1 发现问题，2 参数或读取错误。

注意：检查按「文件集合」建立依赖图，不区分作用域与加载顺序。这会产生
少量保守的误报——同一变量在不同作用域各自声明是合法的，但若某个作用域
内形成 A -> B -> A 的环，那仍然是真实缺陷。遇到误报时用 --allow 跳过具体
变量名，不要直接放宽整个检查。
"""

from __future__ import annotations

import argparse
import re
import sys

# Windows 控制台默认 GBK，打印 ✓ 之类的字符会抛 UnicodeEncodeError，
# 让一个本来通过、只在这里崩溃的检查看起来像是失败。
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GLOB_DIRS = ("web", "web/app")

# 由 JS 在运行时写入元素的变量。这类引用在静态 CSS 里查不到声明，
# 但运行时会由脚本赋值（例如给每个列表项设置 --i 作为动画序号）。
# 只放确信属于这种情况的；「曾经以为有、其实没有」不应加进来——
# --subtle 就是那样漏掉的，导致四个组件的背景一直是透明的。
RUNTIME_VARS = {
    "--i",            # 列表项序号（bots.js / sops.js / platform.css）
    "--card-index",   # 卡片入场序号（sops.js）
    "--bot-progress", # 机器人进度（bots.js）
    "--ink-x",        # 悬停墨迹圆心（hover-ink.js）
    "--ink-y",
    "--ink-d",
    "--lane",         # 泳道主题色（workbench 预览，运行时按泳道设置）
}

# 声明：--name: value;  值可能跨行，故不使用 [^;\n]
DECL_RE = re.compile(r"(--[a-z0-9-]+)\s*:\s*([^;{}]+)", re.I)
# 引用：var(--name) 或 var(--name, fallback)
REF_RE = re.compile(r"var\(\s*(--[a-z0-9-]+)", re.I)
# 带 fallback 的引用：var(--name, something)。这类即使变量未定义也能渲染。
REF_FALLBACK_RE = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*,", re.I)
COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)


def shown(path: Path) -> str:
    """仓库内的文件显示相对路径，仓库外（例如检查临时文件）显示绝对路径。"""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def strip_comments(text: str) -> str:
    """注释里出现 --x: var(--x) 之类的示例不应被当成声明。"""
    return COMMENT_RE.sub("", text)


def css_files(args: list[str]) -> list[Path]:
    if args:
        return [Path(a).resolve() for a in args]
    files: list[Path] = []
    for rel in DEFAULT_GLOB_DIRS:
        base = ROOT / rel
        if base.is_dir():
            files.extend(sorted(base.glob("*.css")))
    # 去重并保持稳定顺序，便于对照输出
    return sorted(set(files))


def parse(files: list[Path]):
    declared: dict[str, list[tuple[Path, int, str]]] = {}
    deps: dict[str, set[str]] = {}
    refs: list[tuple[str, Path, int]] = []

    for path in files:
        try:
            raw = path.read_text(encoding="utf-8", errors="ignore")
        except OSError as err:
            print(f"✗ 无法读取 {path}: {err}", file=sys.stderr)
            raise SystemExit(2)
        text = strip_comments(raw)
        for match in DECL_RE.finditer(text):
            name, value = match.group(1), match.group(2)
            line = text.count("\n", 0, match.start()) + 1
            declared.setdefault(name, []).append((path, line, value.strip()))
            deps.setdefault(name, set()).update(REF_RE.findall(value))
        for match in REF_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            # 向后看同一处的原文，判断是否写了 fallback
            tail = text[match.start():match.start() + 200]
            has_fallback = bool(REF_FALLBACK_RE.match(tail))
            refs.append((match.group(1), path, line, has_fallback))
    return declared, deps, refs


def find_self_references(declared) -> list[str]:
    problems = []
    for name, entries in declared.items():
        for path, line, value in entries:
            if name in REF_RE.findall(value):
                problems.append(
                    f"{shown(path)}:{line}  {name}: {value[:40]}  —— 自引用，解析为空"
                )
    return problems


def find_cycles(deps: dict[str, set[str]], limit: int = 40) -> list[str]:
    """找出所有简单环。变量总量在数百级，DFS 足够。"""
    seen_cycles: set[tuple[str, ...]] = set()
    problems: list[str] = []

    def walk(start: str, node: str, path: list[str]):
        for dep in deps.get(node, ()):
            if dep == start:
                cycles = path + [start]
                # 规范化：从字典序最小的节点起写，便于去重
                pivot = cycles[:-1].index(min(cycles[:-1]))
                key = tuple(cycles[:-1][pivot:] + cycles[:-1][:pivot])
                if key not in seen_cycles:
                    seen_cycles.add(key)
                    problems.append(" -> ".join(cycles) + "  —— 循环引用，环上属性全部为空")
            elif dep not in path and len(path) < 12:
                walk(start, dep, path + [dep])

    for start in deps:
        walk(start, start, [start])
        if len(problems) >= limit:
            problems.append(f"... 仅显示前 {limit} 条")
            break
    return problems


def find_undefined(refs, declared, allow: set[str]) -> list[str]:
    problems = []
    for name, path, line, has_fallback in refs:
        if name in declared or name in allow:
            continue
        # 带 fallback 的引用即使变量未定义也能正常渲染，不算缺陷。
        if has_fallback:
            continue
        problems.append(f"{shown(path)}:{line}  var({name})  —— 未定义且无 fallback")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="检查 CSS 自定义属性的自引用、循环引用与未定义引用。")
    parser.add_argument("files", nargs="*", help="要检查的 CSS 文件；省略则检查 web/ 与 web/app/")
    parser.add_argument("--verbose", action="store_true", help="输出统计信息")
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        metavar="--NAME",
        help="允许未定义的变量（运行时由 JS 注入），可重复",
    )
    args = parser.parse_args()

    files = css_files(args.files)
    if not files:
        print("✗ 没有找到可检查的 CSS 文件", file=sys.stderr)
        return 2

    declared, deps, refs = parse(files)
    allow = {name.strip() for name in args.allow} | RUNTIME_VARS

    if args.verbose:
        print(f"检查 {len(files)} 个文件，声明 {len(declared)} 个变量，引用 {len(refs)} 次\n")

    groups = [
        ("自引用", find_self_references(declared)),
        ("循环引用", find_cycles(deps)),
        ("未定义引用", find_undefined(refs, declared, allow)),
    ]

    failed = False
    for title, problems in groups:
        if not problems:
            continue
        failed = True
        print(f"✗ {title}（{len(problems)}）")
        for item in problems:
            print(f"    {item}")
        print()

    if failed:
        print("CSS 变量检查未通过。以上问题都会让 var(--x) 拿到空值，界面上表现为颜色丢失。")
        return 1

    print(f"✓ CSS 变量检查通过（{len(declared)} 个变量，{len(files)} 个文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
