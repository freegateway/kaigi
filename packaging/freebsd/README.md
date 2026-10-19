# Application configuration and administrator documentation

This directory contains Kaigi-owned configuration examples, administrator
manual templates and the application-specific fail2ban filter. They track
the application version and are installed by the FreeBSD port.

The port Makefile, source/dependency checksums, service script, log rotation,
package messages and packing rules are maintained in
[kaigi-freebsd-port](https://github.com/freegateway/kaigi-freebsd-port).
The port substitutes installation paths in the `.in` templates; these files
are not ready-to-use live configuration. Keep deployment secrets outside Git.
