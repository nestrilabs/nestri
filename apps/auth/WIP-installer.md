# Installer sign-in (work in progress; deleted in the final commit)

Branch: feat/installer-sign-in

## Done
- 1. installer device client, 15 min, no refresh (engine `clientTTL`, apps/auth `clientTTL`)
- 2. per-address limit on POST /device/authorize (engine `deviceVerification.requestLimit`), 429 slow_down + Retry-After
- 3. confirm wording per client (engine `deviceConfirm`, apps/auth `deviceConfirm`), preview entry
- 4. api middleware: aud `installer` only on POST /machine/install-token, else 403 (test: apps/api/test/install-token.test.ts)
- 5. core InstallToken.create: 5/h + 3 outstanding per user (HOURLY_LIMIT, OUTSTANDING_LIMIT), 429 too_many_requests
- 6. Machine.TEAM_MACHINE_LIMIT = 10 in Machine.register (team row lock) + InstallToken.create, 429 quota_exceeded
- 7. install.sh: token optional; NESTRI_INSTALL_TOKEN unset when none

## Left
1. issuer: `installer` device client, 15 min access, no refresh token
2. issuer: per-address limit on POST /device/authorize (10 per 600 s)
3. issuer: confirm screen wording for `installer`
4. api: `installer` audience accepted only on POST /machine/install-token
5. api: 5 install tokens per user per hour, 3 outstanding
6. api: 10 machines per team, at mint and at registration
7. install.sh: token optional

## Resume
Test db: postgres://postgres:postgres@127.0.0.1:5434/nestri_installer
(migrate with `DATABASE_URL=... bun run db:migrate` from the repo root;
run tests with TEST_DATABASE_URL and DATABASE_URL both set to it).
