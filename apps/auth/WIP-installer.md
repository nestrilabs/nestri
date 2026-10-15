# Installer sign-in (work in progress; deleted in the final commit)

Branch: feat/installer-sign-in

## Done
- 1. installer device client, 15 min, no refresh (engine `clientTTL`, apps/auth `clientTTL`)
- 2. per-address limit on POST /device/authorize (engine `deviceVerification.requestLimit`), 429 slow_down + Retry-After
- 3. confirm wording per client (engine `deviceConfirm`, apps/auth `deviceConfirm`), preview entry

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
