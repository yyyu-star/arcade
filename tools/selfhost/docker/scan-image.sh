#!/usr/bin/env bash
# 推镜像前的检查：镜像里不许有任何凭证、站点主机名、D1 id。selfhost-image.yml 在推之前对导出的镜像文件系统跑一遍，本地也能跑：
#   docker create --name scan arcade:local && docker export scan | tar -x -C <目录> && tools/selfhost/docker/scan-image.sh <目录> arcade:local
# 只查我们放进去的 /app 和镜像的环境变量（基础镜像是官方的 debian:bookworm-slim）。
set -euo pipefail
root=${1:?用法：scan-image.sh <导出的镜像根目录> [镜像名，查环境变量]}
image=${2:-}
app="$root/app"
[ -d "$app" ] || { echo "scan：$app 不存在" >&2; exit 1; }
bad=0
fail() {
  echo "scan：$*" >&2
  bad=1
}

# 1. 不该有的文件：Secret 文件、密钥、npm/git 凭证
found=$(find "$app" \( -name '*.env' -o -name '.env*' -o -name '.dev.vars*' -o -name 'pg_password*' -o -name '.npmrc' -o -name '.git-credentials' \
  -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.pem' -o -name '*.key' -o -name '.git' \) -print)
[ -z "$found" ] || fail "有不该进镜像的文件：$found"

# 2. 内容里的凭证样式（全部 /app，含各模块打好的包和静态资源）
pat='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|npm_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}'
pat="$pat|(PEPPER_(PW|RC|SID|IP)(_PREV)?|ADMIN_TOKEN|ARCADE_PG_URL|CLOUDFLARE_API_TOKEN|GH_TOKEN|GITHUB_TOKEN)[\"']?[[:space:]]*[=:][[:space:]]*[\"']?[A-Za-z0-9_-]+:[A-Za-z0-9+/_-]{8,}"
pat="$pat|postgres(ql)?://[^:/@[:space:]\"']+:[^@[:space:]\"']+@"
hits=$(grep -rIlE -e "$pat" "$app" || true)
[ -z "$hits" ] || fail "这些文件里有像凭证的内容：$hits"

# 3. 配置（config.capnp、release.json、各 Worker 的变量嵌入）：不许有站点主机名、D1 id。站点主机名、域名都只能运行时给（SITE_ORIGIN、SITE_HOST）。
#    不查 assets.json（静态资源清单和仓库里 _headers 的 CSP，含第三方的主机名）和迁移、覆盖表（SQL 原文）：它们来自仓库，仓库本来就不写正式域名
configs=$(find "$app" -maxdepth 4 \( -name config.capnp -o -name release.json -o -path '*/workers/*.json' \) \
  ! -name assets.json ! -name '*-migrations.json' ! -name '*-overrides.json' -print)
for f in $configs; do
  if grep -qiE 'database_id|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$f"; then fail "$f 里有 D1 id 样子的内容"; fi
  # 网址、带常见顶级域的主机名：只许示例域名和本机
  hosts=$(grep -oiE '([a-z0-9-]+\.)+(com|org|net|io|dev|app|cn|co|me|xyz|cloud|site|top|info|games?)\b' "$f" | sort -u \
    | grep -viE '^(([a-z0-9-]+\.)*example\.(com|org|net)|localhost)$' || true)
  [ -z "$hosts" ] || fail "$f 里有主机名：$(echo "$hosts" | tr '\n' ' ')"
done

# 4. 镜像的环境变量：只许启动脚本认的那几个，不许带值像 Secret 的
if [ -n "$image" ]; then
  extra=$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image" | cut -d= -f1 | grep -vE '^(PATH|ARCADE_DB|ARCADE_DATA|ARCADE_LISTEN|ARCADE_ADMIN_LISTEN)?$' || true)
  [ -z "$extra" ] || fail "镜像带了多余的环境变量：$extra"
fi

[ "$bad" = 0 ] || exit 1
echo "scan：通过（$(find "$app" -type f | wc -l) 个文件，$(echo "$configs" | wc -w) 个配置）"
