# Security policy

## Supported versions

Minab is before 1.0. Only the latest release gets security fixes. From 1.0 on, the latest minor version of the
current major version and the last minor version of the previous major version are supported.

| Version | Supported |
|---|---|
| latest release (`@shamsine/minab` on npm, and the VS Code extension) | yes |
| older releases | no, please update |

## How to report a problem

Send an email to **security@minab-lang.org**. Please do not open a public issue for a security problem.

Please include:

- what you found, and what it lets an attacker do;
- a Minab program, a schema and (if it matters) a host setup that show it;
- the version of `@shamsine/minab` and the version of Node.js.

The repository is private, so GitHub private vulnerability reporting is not available. If the repository becomes
public, it will be turned on next to the email address.

## What to expect

- We answer within **7 days**. The answer says if we can reproduce the problem.
- We tell you when a fix is planned. We fix problems that let a program crash or hang its host, inject SQL, read
  outside its schema, or leak data first.
- We publish the fix in a release, and the release notes (`CHANGELOG.md`, type `security`) say what was fixed.
  We credit you if you want.

## What counts

A program written by an end user must not be able to crash its host, run forever, inject SQL, read outside the
schema it was given, or put data it should not have into logs. A way to do one of these is a security problem.

Not a security problem: a program that gives a wrong answer, a slow program that stays inside its limits, or a
host that turned the limits off or accepted SQL or a schema from a browser. How a host stays safe is in
[`docs/security.md`](docs/security.md).
