# DNS

Cloudflare holds the zones. Once the control plane moves off Workers that is
the only thing it holds, so this file is deliberately written to survive the
move: it says what each name **is for**, and treats what currently answers it
as a detail that changes.

There is no infrastructure-as-code here, on purpose. There are six records.
They change roughly never, they outlive several generations of whatever serves
them, and the failure mode of getting one wrong is that sign-in stops working
for everybody — which is a thing to do slowly, by hand, having read this table,
rather than as a side effect of a deploy. What *is* automated is only the part
that must stay in step with a deploy: while the control plane is a set of
Workers, `wrangler` creates and owns the four control-plane records itself,
because a route and its hostname are one fact and splitting them across two
tools is how they drift.

## The rule

**A domain gets one certificate, obtained once, and it covers that domain and
nothing else.** Names are then grouped so that the grouping is the same shape
as the certificate: production sits directly under `nestri.io`, and everything
that is not production sits under `sandbox.nestri.io`.

That is why the sandbox names are nested rather than hyphenated. `sandbox` is a
domain, not a prefix — it holds whatever is not production, which today is the
API and the issuer and later is more. Once the shape is a domain, a single
certificate for `*.sandbox.nestri.io` covers all of it, including per-pull-
request deployments at `pr-<id>.sandbox.nestri.io` if those ever arrive; those
would be unbounded and unpredictable names, which is precisely the case that a
name-by-name certificate cannot serve and a domain-wide one can.

It also means a certificate that can be presented for a sandbox name cannot be
presented for `api.nestri.io`. Leaning on the zone-wide `*.nestri.io` instead
would have given every scratch deployment a certificate for production's own
domain, which is the opposite of what a sandbox is for.

Nothing extra is needed while these are Workers — a custom domain is issued its
own certificate for the exact hostname, at any depth. The rule binds on the day
they become origins, and it is written down now because that is the day it is
expensive to have got wrong.

## `nestri.io`

| Name                     | What it is                       | Answered today by    |
| ------------------------ | -------------------------------- | -------------------- |
| `nestri.io`              | The website, and `ssh nestri.io` | Website              |
| `api.nestri.io`          | The API, production              | Worker custom domain |
| `auth.nestri.io`         | The issuer, production           | Worker custom domain |
| `doctor.nestri.io`       | Where `nesdoctor` is downloaded  | Static site          |

## `sandbox.nestri.io`

Everything that is not production, under one domain and one certificate.

| Name                      | What it is         | Answered today by    |
| ------------------------- | ------------------ | -------------------- |
| `api.sandbox.nestri.io`   | The API, sandbox   | Worker custom domain |
| `auth.sandbox.nestri.io`  | The issuer, sandbox| Worker custom domain |

`auth.nestri.io` is the one name in either table that cannot be changed
casually. A token carries the address it was minted through in its `iss` claim,
and every API request verifies that claim literally — so renaming the issuer
invalidates every token in circulation at once, including the refresh tokens
that would otherwise have recovered from it. The sandbox issuer has the same
property and none of the consequences, which is the point of having one.

## After the move off Workers

*Rewritten 2026-09-16. This said each name becomes **a proxied `A` record
pointing at the host**, and described an ordering to avoid a gap while Worker
routes were removed. Both are wrong now, and for two different reasons.*

**There is no `A` record, because there is no address to put in one.** The
control plane is reached through a Cloudflare Tunnel, so each name is a
**proxied `CNAME` to `<tunnel-uuid>.cfargotunnel.com`** — a target that resolves
to nothing publicly and only means something inside Cloudflare. The machine's
own address appears in no record anywhere, which is the point: an `A` record is
a published address, and a published address is a thing that can be reached
around the proxy and flooded off the internet.

| Name | Record | Ingress rule on the machine |
| --- | --- | --- |
| `api.nestri.io` | `CNAME` → `<uuid>.cfargotunnel.com`, proxied | `http://127.0.0.1:3000` |
| `auth.nestri.io` | `CNAME` → `<uuid>.cfargotunnel.com`, proxied | `http://127.0.0.1:1337` |
| `*.nestri.link` | `CNAME` → `<uuid>.cfargotunnel.com`, proxied | `http://127.0.0.1:8443` — whatever serves box hostnames |

One tunnel serves all three, including the two zones, because a tunnel belongs
to the **account** and not to a zone. Measured 2026-09-16, both zones at once,
from one connector.

**The ordering problem does not exist, because there is nothing to cut over
from.** Checked on 2026-09-16: `api.nestri.io` and `auth.nestri.io` have no DNS
records and do not resolve. Only the *sandbox* pair was ever deployed, and it is
discarded by the move. So these names are created for the first time, pointing
at the tunnel, with no window in which anything is worse than it was.

Two things that are true of a tunnel and were not true of a proxied origin:

- **The record can be created before the machine exists, and it is harmless.**
  A `CNAME` to a tunnel with no connector running answers with Cloudflare's own
  error rather than resolving to somebody else's server — so the name is never
  pointed anywhere it should not be, even for a minute. *Asserted, not measured:
  the 2026-09-16 run only ever had the records and the connector up together.*
- **The zone must stay proxied — and here the failure is worse than before.**
  An unproxied `CNAME` to `cfargotunnel.com` resolves to nothing at all. This
  is the same *"pausing Cloudflare is an outage, not a fallback"* the origin
  certificate used to imply, and it survives the certificate's removal.

## `nestri.link`

A second zone, reserved and not yet serving anything. It exists so that a
per-box hostname — one name, one box, the address a person opens to set their
box up — never has to live under `nestri.io` beside the control plane. Two
reasons, both of which get worse to fix later than to decide now: a box serves
content we do not write, and cookie scope is a property of the registrable
domain, so a name under `nestri.io` would put that content inside the same
cookie boundary as sign-in.

`*.nestri.link` is proxied for the same reason the control plane is: the public
certificate stays Cloudflare's. ~~and the only key on our own host is an origin
certificate that is useless anywhere else~~ — *corrected 2026-09-16:* **there is
no key on our own host at all.** TLS terminates at Cloudflare and the tunnel
reaches whatever serves these hostnames over loopback, so the origin certificate
this sentence promised is not obtained, not stored, and not renewed.

Measured the same day, and the negative is the useful half: a public HTTPS
request to `m123.nestri.link` was served correctly while nothing on the machine
listened on `443` or `8443` and both origins spoke plain HTTP on `127.0.0.1`.
The certificate presented was `O=Google Trust Services, CN=WE1`, `SAN:
nestri.link, *.nestri.link` — issued by Cloudflare on a zone that held zero DNS
records, without being asked.

**One level, and it fails before HTTP.** That SAN covers `nestri.link` and
`*.nestri.link` and nothing deeper, so `deep.a.nestri.link` is refused with a
TLS `handshake failure` and **no certificate presented**. Not a `404` — nothing
reaches an application, so no application log will explain it. This is why
`box_id` is a single DNS label and why a two-label scheme costs $10/mo for
Advanced Certificate Manager rather than being free.
