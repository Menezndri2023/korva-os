#!/usr/bin/env bash
#
# Prepares a fresh Ubuntu 24.04 VPS to run docker-compose.prod.yml. Idempotent — safe to re-run.
#
#   scp docker/host/bootstrap-vps.sh root@<IP>:/root/
#   ssh root@<IP> 'bash /root/bootstrap-vps.sh korva'
#
# The argument is the unprivileged user to create (default: korva). Run as root, once, on a
# brand-new host. It does NOT deploy the application — it only makes the host able to.
set -euo pipefail

DEPLOY_USER="${1:-korva}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades

log "Unprivileged user: ${DEPLOY_USER}"
# The application is never operated as root. Compose, logs and .env.production all live under
# this user, so a mistake in a deploy command cannot touch the rest of the system.
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  # Copy root's authorized_keys so the key you already used to log in keeps working.
  if [ -f /root/.ssh/authorized_keys ]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
      /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi

log "Docker Engine + Compose plugin"
# Docker's own repository, not Ubuntu's `docker.io` package: the distro package lags and does
# not ship the `compose` v2 plugin this project's commands rely on.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$DEPLOY_USER"

log "Firewall"
# Only what Caddy and SSH need. Nothing else is reachable: the app containers expose their ports
# on the Docker network only, never on the host, so there is nothing else to open.
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp  comment 'SSH' >/dev/null
ufw allow 80/tcp  comment 'HTTP - ACME challenge + redirect' >/dev/null
ufw allow 443/tcp comment 'HTTPS - Caddy' >/dev/null
ufw --force enable >/dev/null

log "Kernel settings for Redis"
# Redis warns about both at startup, and both matter here because Redis runs with appendonly:
#  - overcommit_memory=1: a background AOF rewrite forks, and with the default (0) the kernel
#    can refuse the fork when memory looks tight, leaving the AOF unrewritten and growing.
#  - somaxconn: the default backlog is small; BullMQ opens 26 long-lived connections from a
#    single API instance, and more per instance if you ever scale out.
cat > /etc/sysctl.d/99-korva-redis.conf <<'SYSCTL'
vm.overcommit_memory = 1
net.core.somaxconn = 1024
SYSCTL
sysctl -q --system

log "Transparent Huge Pages"
# THP causes latency spikes and higher memory use during Redis's fork-based persistence. Redis
# itself recommends disabling it. Applied now and re-applied at boot.
echo never > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true
cat > /etc/systemd/system/disable-thp.service <<'UNIT'
[Unit]
Description=Disable Transparent Huge Pages (recommended for Redis)
After=sysinit.target local-fs.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled'

[Install]
WantedBy=basic.target
UNIT
systemctl daemon-reload
systemctl enable --now disable-thp.service >/dev/null 2>&1 || true

log "Unattended security upgrades"
# Security patches without a human. Deliberately does NOT auto-reboot: a reboot at 06:00 would
# restart the containers too, and that should be a decision, not a surprise.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT

log "Swap"
# 2 GB of swap on an 8 GB host. Not for running in swap — for surviving a Next.js build or a
# memory spike instead of having the kernel kill a container.
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Verification"
printf '  docker          : %s\n' "$(docker --version 2>/dev/null || echo ABSENT)"
printf '  compose         : %s\n' "$(docker compose version --short 2>/dev/null || echo ABSENT)"
printf '  user %-10s : %s\n' "$DEPLOY_USER" "$(id -nG "$DEPLOY_USER" 2>/dev/null || echo ABSENT)"
printf '  ufw             : %s\n' "$(ufw status | head -1)"
printf '  ports ouverts   : %s\n' "$(ufw status | awk '/ALLOW/{printf "%s ", $1}')"
printf '  overcommit      : %s (attendu 1)\n' "$(cat /proc/sys/vm/overcommit_memory)"
printf '  THP             : %s\n' "$(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo n/a)"
printf '  swap            : %s\n' "$(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
printf '  RAM             : %s\n' "$(free -h | awk '/^Mem:/{print $2}')"

cat <<NEXT

==> Hôte prêt.

Prochaines étapes, en tant que ${DEPLOY_USER} (pas root) :
  1. Se reconnecter : ssh ${DEPLOY_USER}@<IP>        (l'appartenance au groupe docker exige une nouvelle session)
  2. git clone <repo> korva-os && cd korva-os
  3. Copier .env.production depuis une source sûre — ne jamais le committer
  4. Suivre docs/deployment.md à partir de l'étape 3 (DNS)

NEXT
