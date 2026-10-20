# 自托管的镜像：构建上下文是 release.sh 生成的发布目录（arcade-<版本>/），镜像里和二进制形态是同一份东西、同一个启动脚本。
#   docker build -f tools/selfhost/docker/Dockerfile -t arcade:<版本> <发布目录>
# 分层按变动频率从低到高：系统 → workerd 二进制 → 运行时和配置、各模块的包 → 静态资源（变得最多，放最上层，升级时只拉这几层）。
FROM debian:bookworm-slim
# curl：健康检查和容器里跑备份脚本；ca-certificates：以后 PostgreSQL 模式出站 TLS 要用
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin arcade \
 && install -d -o arcade -g arcade /data
WORKDIR /app
COPY bin/workerd bin/workerd
COPY bin/arcade bin/arcade
COPY ops ops
COPY config.capnp release.json ./
COPY runtime runtime
COPY workers workers
COPY assets assets
USER arcade
# 站点听容器网卡（compose 里只给 caddy 连，不发布到宿主）；管理入口只听容器内的 127.0.0.1，备份恢复用 docker exec 进来跑 ops/ 下的脚本
ENV ARCADE_DATA=/data/do \
    ARCADE_LISTEN=0.0.0.0:8787 \
    ARCADE_ADMIN_LISTEN=127.0.0.1:8788
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:8787/__health || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/bin/arcade"]
