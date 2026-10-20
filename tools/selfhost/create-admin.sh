#!/bin/sh
# 建第一个管理员（新站点没有账号、注册默认关着）：用 ADMIN_TOKEN 调平台的 /api/admin/users，打印这个号的密码和恢复码（只打印这一次，记好）。
# 在跑站点的地方执行，令牌从环境变量或 Secret 文件读，不上命令行：
#   Docker：docker exec arcade /app/ops/create-admin.sh admin 管理员
#   二进制：sudo /opt/arcade/current/ops/create-admin.sh admin 管理员（读 /etc/arcade/secrets.env）
# 用法：create-admin.sh <用户名> <昵称> [Secret 文件，默认 /etc/arcade/secrets.env]
set -eu
user=${1:?用法：create-admin.sh <用户名> <昵称> [Secret 文件]}
name=${2:?用法：create-admin.sh <用户名> <昵称> [Secret 文件]}
secrets=${3:-/etc/arcade/secrets.env}
if [ -z "${ADMIN_TOKEN:-}" ] && [ -r "$secrets" ]; then
  set -a
  . "$secrets"
  set +a
fi
: "${ADMIN_TOKEN:?没有 ADMIN_TOKEN（环境变量或 Secret 文件里）}"
port=${ARCADE_LISTEN:-127.0.0.1:8787}
port=${port##*:}
# 设了 SITE_ORIGIN 时 /api 只认那个主机名：从本机连也带上它
host=127.0.0.1
[ -n "${SITE_ORIGIN:-}" ] && host=${SITE_ORIGIN#*://}
# 用户名、昵称只许常见字符进 JSON（平台还会再校验一遍），免得引号把请求体拼坏
case "$user$name" in *[\"\\]*) echo "create-admin：用户名和昵称里不能有引号和反斜杠" >&2; exit 1 ;; esac
curl -fsS -X POST "http://127.0.0.1:$port/api/admin/users" \
  -H "host: $host" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data "{\"username\":\"$user\",\"displayName\":\"$name\",\"role\":\"admin\"}"
echo
