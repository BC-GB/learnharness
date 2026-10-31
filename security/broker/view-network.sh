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
iptables -A INPUT -m conntrack --ctstate ESTABLISHED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
# Only the view's own HTTP endpoint is reachable via loopback; no DNS exception.
iptables -A OUTPUT -s 127.0.0.1 -d 127.0.0.1 -p tcp --dport 8080 -j ACCEPT
[ "${LH_VIEW_FAIL_INIT:-0}" = 0 ] || exit 61
printf ready > /run/fw-ready
exec setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --securebits=+noroot,+noroot_locked --no-new-privs sleep infinity
