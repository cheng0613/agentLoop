#!/bin/sh
# 把 scripts/pre-commit 安装到 .git/hooks。
#
# 为什么用脚本而不是直接提交 .git/hooks
# ----------------------------------------------------------------
# git 不会跟踪 .git/hooks 里的文件，团队成员克隆后拿到的是 *.sample。
# 因此钩子本体放在 scripts/pre-commit（受版本控制），由这个脚本复制到位。
#
# 用法：
#   bash scripts/install-hooks.sh
#
# 重复执行是安全的：已有同名钩子会被覆盖（钩子内容以仓库为准）。

set -e

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
	printf '✗ 当前目录不在 git 仓库内\n' >&2
	exit 1
}

cd "$root" || exit 1

src=scripts/pre-commit
dst=.git/hooks/pre-commit

[ -f "$src" ] || {
	printf '✗ 找不到 %s\n' "$src" >&2
	exit 1
}

# 已存在且不是本仓库装的钩子时先备份，避免覆盖别人的自定义钩子。
if [ -f "$dst" ] && ! grep -q 'pre-commit：在提交前挡住三类' "$dst" 2>/dev/null; then
	backup="$dst.backup.$(date +%Y%m%d%H%M%S)"
	cp "$dst" "$backup"
	printf '· 已备份原有钩子到 %s\n' "$backup"
fi

cp "$src" "$dst"
chmod +x "$dst"

printf '✓ pre-commit 钩子已安装到 %s\n' "$dst"
printf '  跳过检查：git commit --no-verify\n'
