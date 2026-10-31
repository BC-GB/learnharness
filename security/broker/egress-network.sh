#!/bin/sh
set -eu
rm -f /run/fw-ready
for tool in iptables ip6tables; do
 "$tool" -P INPUT DROP
 "$tool" -P OUTPUT DROP
 "$tool" -P FORWARD DROP
 "$tool" -F INPUT
 "$tool" -F OUTPUT
 "$tool" -F FORWARD
done
# Reject LAN, host, metadata and reserved destinations even if supplied as pins.
for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
 iptables -A OUTPUT -d "$range" -j DROP
done
for address in "${LH_AUTH_IPV4:?Authentication address required}" "${LH_API_IPV4:?API address required}"; do
 case "$address" in ''|*[!0-9.]*) exit 62;; esac
 iptables -A OUTPUT -p tcp -d "$address/32" --dport 443 -j ACCEPT
done
iptables -A INPUT -m conntrack --ctstate ESTABLISHED -j ACCEPT
# No DNS exception: relay uses deployment-pinned IPv4 addresses directly.
[ "${LH_EGRESS_FAIL_INIT:-0}" = 0 ] || exit 61
printf ready > /run/fw-ready
exec setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --securebits=+noroot,+noroot_locked --no-new-privs sleep infinity
