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

Each of the four control-plane names becomes a proxied `A` record pointing at
the host running the containers, and nothing else about them changes: same
names, same `iss` claim. Cloudflare keeps terminating public TLS, so there is
no certificate on our own host to renew, and the origin is not addressable
except through the proxy.

The order that matters, on the day: create the `A` records with the proxy on,
confirm the containers answer through them, *then* remove the Worker routes.
Doing it the other way leaves a window where the name resolves to nothing.

## `nestri.link`

A second zone, reserved and not yet serving anything. It exists so that a
per-box hostname — one name, one box, the address a person opens to set their
box up — never has to live under `nestri.io` beside the control plane. Two
reasons, both of which get worse to fix later than to decide now: a box serves
content we do not write, and cookie scope is a property of the registrable
domain, so a name under `nestri.io` would put that content inside the same
cookie boundary as sign-in.

`*.nestri.link` will be proxied for the same reason the control plane is: the
public certificate stays Cloudflare's, and the only key on our own host is an
origin certificate that is useless anywhere else.
