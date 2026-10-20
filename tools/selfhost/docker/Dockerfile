# syntax=docker/dockerfile:1
# 自托管的镜像：构建上下文是 release.sh 生成的发布目录（arcade-<版本>/），镜像里和二进制形态是同一份东西、同一个启动脚本。
#   docker build -f tools/selfhost/docker/Dockerfile -t arcade:local <发布目录>
# 发布到 ghcr.io/yyyu-star/arcade 的镜像由 selfhost-image.yml 打（多架构、带 PG 档）。
# 镜像里没有任何 Secret、站点主机名：全部运行时从环境变量取（docker run --env-file、compose 的 env_file）。
# 多架构：上下文里有 bin/workerd-<架构>（amd64、arm64）就按目标架构取那一个，没有就用 bin/workerd（release.sh 放的本机那一份）。
# 分层按变动频率从低到高：系统 → workerd 二进制 → 运行时和配置、各模块的包 → 静态资源（变得最多，放最上层，升级时只拉这几层）。
FROM debian:bookworm-slim
ARG TARGETARCH
# curl：健康检查和容器里跑运维脚本；ca-certificates：PostgreSQL 走 TLS 时要用
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin arcade \
 && install -d -o arcade -g arcade /data
WORKDIR /app
RUN --mount=type=bind,source=bin,target=/ctx-bin \
    if [ -f "/ctx-bin/workerd-$TARGETARCH" ]; then install -D -m 755 "/ctx-bin/workerd-$TARGETARCH" bin/workerd; \
    else install -D -m 755 /ctx-bin/workerd bin/workerd; fi
COPY bin/arcade bin/arcade
COPY ops ops
COPY config.capnp release.json ./
COPY runtime runtime
COPY workers workers
COPY assets assets
# PG 档（release.sh --with-pg 才有）：ARCADE_DB=pg 时启动脚本用它
RUN --mount=type=bind,target=/ctx if [ -d /ctx/pg ]; then cp -a /ctx/pg pg; fi
USER arcade
# 站点听容器网卡（compose 里只给 caddy 连，不发布到宿主）；管理入口只听容器内的 127.0.0.1，备份恢复用 docker exec 进来跑 ops/ 下的脚本
ENV ARCADE_DB=sqlite \
    ARCADE_DATA=/data/do \
    ARCADE_LISTEN=0.0.0.0:8787 \
    ARCADE_ADMIN_LISTEN=127.0.0.1:8788
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:8787/__health || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/bin/arcade"]
