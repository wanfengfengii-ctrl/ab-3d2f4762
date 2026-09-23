#!/bin/sh
# 一次性复核：代码检查 → 单元裁决 → 构建 → HTTP 冒烟（裁决与静态资源）
# 退出码：0 全部通过；10 代码检查失败；20 裁决测试失败；30 构建失败；40 HTTP 冒烟失败
set -u

WEB_URL="${WEB_URL:-http://web:80}"

step() { printf '\n========== %s ==========\n' "$1"; }
die()  { echo "VERIFY FAIL: $1" >&2; exit "$2"; }

step "1/4 代码检查：tsc --noEmit"
npm run typecheck || die "TypeScript 类型检查未通过" 10

step "2/4 裁决检查：vitest run（可行/唯一/多解/不可行闭合链 + 随机枚举对照）"
npm run test || die "求解器裁决测试未通过" 20

step "3/4 构建检查：vite build 并核验产物"
npm run build || die "vite 构建失败" 30
[ -f dist/index.html ] || die "缺少 dist/index.html" 30
ls dist/assets/*.js >/dev/null 2>&1 || die "缺少 dist/assets/*.js" 30
echo "构建产物就绪：$(ls dist/assets/ | tr '\n' ' ')"

step "4/4 HTTP 冒烟检查：$WEB_URL（裁决页面与静态资源）"
i=0
until wget -q -O /dev/null "$WEB_URL/healthz"; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && die "web 健康检查超时（60s）" 40
  sleep 1
done
echo "健康检查 /healthz 通过"

wget -q -O /tmp/index.html "$WEB_URL/" || die "GET / 失败" 40
grep -q 'id="root"' /tmp/index.html || die "首页缺少 #root 挂载点" 40
echo "首页 200 且包含 #root"

ASSET_JS=$(grep -o '/assets/[^"]*\.js' /tmp/index.html | head -n 1)
[ -n "$ASSET_JS" ] || die "首页未引用 JS 资产" 40
wget -q -O /tmp/app.js "$WEB_URL$ASSET_JS" || die "GET $ASSET_JS 失败" 40
grep -q 'recorders' /tmp/app.js || die "JS 资产缺少应用标识（recorders）" 40
grep -q '审计' /tmp/app.js || die "JS 资产缺少裁决界面文案（审计）" 40
echo "JS 资产 $ASSET_JS 200 且包含裁决应用代码"

ASSET_CSS=$(grep -o '/assets/[^"]*\.css' /tmp/index.html | head -n 1)
if [ -n "$ASSET_CSS" ]; then
  wget -q -O /dev/null "$WEB_URL$ASSET_CSS" || die "GET $ASSET_CSS 失败" 40
  echo "CSS 资产 $ASSET_CSS 200"
fi

wget -q -O /tmp/fallback.html "$WEB_URL/audit/route" || die "SPA 回退失败" 40
grep -q 'id="root"' /tmp/fallback.html || die "SPA 回退内容异常" 40
echo "SPA 回退正常"

echo
echo "VERIFY OK：代码、构建、HTTP 冒烟（裁决与静态资源）全部通过"
exit 0
