#!/bin/sh
# 发布包里的启动脚本（bin/arcade）：在发布目录里起 workerd。systemd 单元和 Docker 都用它，参数都从环境变量来：
#   ARCADE_DATA          数据目录（sqlite 存储时必填，要先建好）；memory 存储不用
#   ARCADE_LISTEN        站点监听，默认 127.0.0.1:8787（前面是 Caddy）
#   ARCADE_DB            sqlite（默认）或 pg：发布包带了 pg/（release.sh --with-pg，发布的镜像都带）时，pg 用那一份 PG 档的配置
#   ARCADE_PG_URL        PG 模式（release.json 里 "db": "pg"）必填：平台库的 PostgreSQL 连接串
#   ARCADE_ADMIN_LISTEN  管理入口监听，默认 127.0.0.1:8788（没有认证，只许回环地址；容器里也只听容器内的 127.0.0.1，用 docker exec 进去调）
# Secret（PEPPER_*、ADMIN_TOKEN、SITE_ORIGIN……）也是环境变量，由 systemd 的 EnvironmentFile 或 docker 的 env_file 给。
set -eu
cd "$(dirname "$0")/.."
workerd=$PWD/bin/workerd
case "${ARCADE_DB:-sqlite}" in
  sqlite) ;;
  pg)
    # 整包本身就是 PG 档（release.sh --db pg）的话直接用；带了 pg/ 子目录的进去用那一份
    if ! grep -q '"db": "pg"' release.json; then
      [ -d pg ] || { echo "arcade：ARCADE_DB=pg，可这个发布包没有 PG 档（打包时加 --with-pg 或 --db pg）" >&2; exit 1; }
      cd pg
    fi
    ;;
  *) echo "arcade：ARCADE_DB 只许 sqlite 或 pg，不认 ${ARCADE_DB}" >&2; exit 1 ;;
esac
admin=${ARCADE_ADMIN_LISTEN:-127.0.0.1:8788}
case "$admin" in
  127.*:* | localhost:* | '[::1]':*) ;;
  *) echo "arcade：管理入口没有认证，只许听回环地址，ARCADE_ADMIN_LISTEN=$admin 不行" >&2; exit 1 ;;
esac
set -- serve config.capnp \
  --socket-addr "http=${ARCADE_LISTEN:-127.0.0.1:8787}" \
  --socket-addr "admin=$admin"
if grep -q '"storage": "sqlite"' release.json; then
  : "${ARCADE_DATA:?sqlite 存储要设 ARCADE_DATA（数据目录）}"
  mkdir -p "$ARCADE_DATA"
  set -- "$@" --directory-path "data=$ARCADE_DATA"
fi
if grep -q '"db": "pg"' release.json; then
  : "${ARCADE_PG_URL:?PG 模式要设 ARCADE_PG_URL（平台库的 PostgreSQL 连接串）}"
fi
exec "$workerd" "$@"
