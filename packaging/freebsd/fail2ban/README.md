# Optional Fail2ban protection for Kaigi

Kaigi logs fixed `authentication_failed` events. The supplied filter matches
invalid credentials only: it does not ban ordinary disconnects, session expiry,
or every rejected meeting event. Fail2ban supplements authentication and bounded
connection lifetimes; it is not enabled by installing Kaigi.

Run Fail2ban with firewall privileges on the host. For a jailed Kaigi instance,
use the host-visible jail log path. Keep an administrative session open and add
your management addresses to `ignoreip` before testing. Shared NAT addresses can
represent many legitimate attendees; start with conservative thresholds.

## Install the filter

As root, after installing security/py-fail2ban:

```sh
install -m 0644 /usr/local/share/kaigi/fail2ban/kaigi.conf /usr/local/etc/fail2ban/filter.d/kaigi.conf
```

Create `/usr/local/etc/fail2ban/jail.d/kaigi.local`:

```ini
[kaigi-staff]
enabled = true
filter = kaigi
backend = polling
logpath = /var/log/kaigi/staff/kaigi.log
usedns = no
maxretry = 5
findtime = 900
bantime = 900
ignoreip = 127.0.0.0/8 ::1 192.0.2.50
action = kaigi-ipfw[table=42]
```

Replace the example management address, instance name, log path, server address
and web port with your deployment's values. For PF use the action below instead.
Use separate jail names and dedicated tables for independent instances; a shared
table deliberately shares bans. Do not share tables with sshguard or other jails.

## IPFW example

These examples manage table membership only, not the host firewall ruleset.
Add an unused table and rule to your existing persistent firewall configuration:

```sh
ipfw table 42 create type addr
ipfw add 120 deny tcp from 'table(42)' to 192.0.2.10 7443 in
```

Choose an unused rule number. Place the deny rule before rules that accept this
traffic, including relevant state shortcuts. Do not replace or flush the host
ruleset. Recreate the table/rule through your usual firewall startup mechanism.

Create `/usr/local/etc/fail2ban/action.d/kaigi-ipfw.conf`:

```ini
[Definition]
actionstart = /sbin/ipfw table <table> list > /dev/null
actioncheck = /sbin/ipfw table <table> list > /dev/null
actionban = /sbin/ipfw table <table> add <ip>
actionunban = /sbin/ipfw table <table> delete <ip>

[Init]
table = 42
```

## PF example

In your existing `/etc/pf.conf`, declare a dedicated table and place the block
rule before matching quick pass rules. Substitute the actual server IP and port:

```pf
table <kaigi_staff> persist
block in quick proto tcp from <kaigi_staff> to 192.0.2.10 port 7443
```

Validate with `pfctl -nf /etc/pf.conf`, then load changes through your normal
firewall administration procedure. Do not enable or reload PF blindly over SSH.
Create `/usr/local/etc/fail2ban/action.d/kaigi-pf.conf`:

```ini
[Definition]
actionstart = /sbin/pfctl -t <table> -T show > /dev/null
actioncheck = /sbin/pfctl -t <table> -T show > /dev/null
actionban = /sbin/pfctl -t <table> -T add <ip>
actionunban = /sbin/pfctl -t <table> -T delete <ip>

[Init]
table = kaigi_staff
```

Set `action = kaigi-pf[table=kaigi_staff]` in the jail. The table must be in the
main ruleset for these commands, not a differently scoped PF anchor.

## Validate and activate

```sh
fail2ban-regex /var/log/kaigi/staff/kaigi.log /usr/local/etc/fail2ban/filter.d/kaigi.conf
fail2ban-client -t
sysrc fail2ban_enable="YES"
service fail2ban start
fail2ban-client status kaigi-staff
```

If Fail2ban already runs, reload it using your installation's supported procedure
rather than starting another process. Test from a disposable non-management
address and confirm both the firewall table and new connection blocking. Unban
with `fail2ban-client set kaigi-staff unbanip ADDRESS` when finished. Recheck after
log rotation, reboot and firewall reload; table reloads may clear active bans.

The illustrated rules cover one IPv4 web listener. Add rules for additional
addresses, IPv6 and listeners as required. They do not intentionally block UDP
conference media or terminate established connections; existing firewall states
may survive a ban. Never kill unrelated states to test this feature. Review
Fail2ban stop/restart and restored-ban behavior locally. These are configuration
examples, not a claim of live PF/IPFW testing.

Upstream references: [Fail2ban documentation](https://github.com/fail2ban/fail2ban/wiki),
[IPFW action](https://github.com/fail2ban/fail2ban/blob/master/config/action.d/bsd-ipfw.conf),
[PF action](https://github.com/fail2ban/fail2ban/blob/master/config/action.d/pf.conf).
