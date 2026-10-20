#!/usr/bin/env bash
# 第一次安装（root，Debian/Ubuntu）：建 arcade 用户和目录、生成 Secret（已有就不动）、装 systemd 单元，再按升级的流程装上发布包。
# 用法：先解开发布包，再 arcade-<版本>/ops/install.sh <arcade-版本.tar.gz> <站点主机名，比如 game.example.com>
# Caddy 另装（apt install caddy），把 ops/Caddyfile 拷到 /etc/caddy/Caddyfile，在 /etc/default/caddy 里写 SITE_HOST=<主机名>。
set -euo pipefail
tarball=${1:?用法：install.sh <arcade-版本.tar.gz> <站点主机名>}
host=${2:?用法：install.sh <arcade-版本.tar.gz> <站点主机名>}
here=$(cd "$(dirname "$0")" && pwd)
id arcade >/dev/null 2>&1 || useradd --system --home-dir /var/lib/arcade --shell /usr/sbin/nologin arcade
install -d -m 755 /opt/arcade/releases
install -d -m 750 -o root -g arcade /etc/arcade
if [ ! -f /etc/arcade/secrets.env ]; then
  # pepper 和管理令牌的格式是 "<kid>:<随机串>"（platform/.dev.vars.example）；只写进文件，不打印
  r() { echo "k1:$(head -c 32 /dev/urandom | base64 | tr -d '/+=')"; }
  umask 027
  {
    echo "SITE_ORIGIN=https://$host"
    for k in PEPPER_PW PEPPER_RC PEPPER_SID PEPPER_IP ADMIN_TOKEN; do echo "$k=$(r)"; done
  } >/etc/arcade/secrets.env
  chgrp arcade /etc/arcade/secrets.env
  chmod 640 /etc/arcade/secrets.env
  echo "install：已生成 /etc/arcade/secrets.env（pepper 一旦用上就不能丢，和备份分开另存一份）"
fi
install -m 644 "$here/systemd/arcade.service" /etc/systemd/system/arcade.service
systemctl daemon-reload
systemctl enable arcade
"$here/upgrade.sh" "$tarball"
