# Contributing to GALAXIE Toolbox

Thanks for your interest in contributing. This document explains how to
propose changes and the terms under which contributions are accepted.

## License of contributions

GALAXIE Toolbox is licensed under the **Apache License, Version 2.0** (see
[`LICENSE`](LICENSE)). By submitting a contribution (a pull request, patch,
or any other material) you agree that your contribution is licensed under
the same Apache-2.0 terms (inbound = outbound), and that you have the right
to license it that way. The Apache-2.0 patent grant in section 3 of the
License applies to your contribution.

## Ground rules

- Be respectful. This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).
- **Never commit secrets** (tokens, credentials, private keys, `.env` values).
  If you find a secret in history, report it privately (see
  [`SECURITY.md`](SECURITY.md)) rather than opening a public issue.
- Do not report security vulnerabilities in public issues — see
  [`SECURITY.md`](SECURITY.md).

## Proposing a change

1. Open (or comment on) an issue describing the change, so the direction can
   be agreed before you invest time.
2. Branch from the integration branch (`pre-prod`).
3. Keep the change focused; write tests for behaviour you add or fix.
4. Open a pull request against `pre-prod`. Continuous integration must be
   green — the required checks are the frontend gate, the Rust build, and
   Clippy.
5. A maintainer reviews and merges. Squash/merge policy follows the
   repository settings.

## Commit messages

Use clear, imperative commit subjects (e.g. `fix(remote): ...`). Reference
the relevant issue (`Refs #NNN` / `Closes #NNN`).

## Questions

Open an issue with the `question` label, or start a discussion. We aim to
respond within a few business days.
