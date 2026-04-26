# Genius API Auth — Questions for Stafford

**Date:** 2026-04-20
**Status:** Protocol fully reverse-engineered via Swagger. Only user provisioning remains.

## TL;DR

We have the full Genius REST API spec (via `/swagger/docs/v17.1.6.3`). The login contract is clear. **The only thing blocking us is a Genius user account.** AD identity alone isn't enough — Genius has its own user table and `chrish` isn't in it (checked against all 10 company codes).

---

## What we need from Stafford

**Primary ask:** Provision a Genius user for the CTP integration. Our strong preference is a **dedicated service account** rather than reusing a human user's credentials.

Specifically:
1. **Which company code should we log into?** We assume `STAFFO` (Stafford Engineering NZ) for production integration, or `WORK7` (Development Test Environment) for initial testing. Please confirm which one you want us to use first.
2. **What username would you like us to use?** If you're provisioning a service account, we'd suggest a dedicated name like `CTP_INTEGRATION` or similar — something non-human that signals what the account is for.
3. **Is password encryption enabled** in your web.config? (The API optionally accepts HMAC-SHA256-encrypted passwords.) If yes, share the encryption key; if no, plain password is fine.
4. **Read scopes / role assignments:** the integration needs to read WorkOrders, Production Tasks, Sales Orders, and Machine/Resource data. No writes. Please scope the service account accordingly.

Secondary (nice to know):
- Is the custom port `:53215` permanent, or a dev/test assignment that could change?
- Any rate limits / throttling we should know about before running full paginated syncs?
- Preferred sync cadence from your side (hourly? real-time? once per day?)

---

## What we've figured out (so you don't have to explain it)

### Login contract — confirmed

```
POST https://genius.stafford.co.nz:53215/api/auth
Content-Type: application/json

{
  "CompanyCode": "<company>",
  "Username": "<genius-user>",
  "Password": "<password>"
}

→ Response:
{
  "Result": {
    "Token": "<bearer-hex>",
    ...
  },
  "Messages": [],
  ...
}
```

Then on every subsequent API call:
```
Authorization: Bearer <token-hex>
```

Source: your Swagger spec at `/swagger/docs/v17.1.6.3` — the `RestAuthenticationInfo` DTO plus the POST /api/auth endpoint documentation.

### Envelope — matches our adapter

Every response wraps data in `{Result, Messages, PagingInfos, Tag}`. Our REST adapter was already written to expect this shape (originally reverse-engineered from your earlier Genius sample data), so we don't need to refactor that for Stafford.

### Network — works cleanly

- DNS + TLS to `genius.stafford.co.nz:53215` over VPN: ~300ms, no cert issues
- Host: `SELERP.stafford.local` (internal AD)
- Bearer / Negotiate / NTLM all offered; we'll use Bearer with the token from `/api/auth`

### What we probed (and what each attempt revealed)

| Attempt | Result |
|---|---|
| Anonymous GET `/api/data/fetch/...` | 401 Genius JSON `InvalidSession` — app wants session token |
| NTLM with local Windows account | 401 IIS HTML — IIS rejected (not a domain user) |
| NTLM with `STAFFORD\chrish` | 401 Genius JSON `InvalidSession` — cleared IIS but app still wants its own session |
| POST `/api/auth` with form-encoded body | 415 — app wants JSON specifically |
| POST `/api/auth` with wrong JSON field casing | 500 — body parsed but fields unrecognized |
| POST `/api/auth` with correct Pascal-case body + any username we've tried | 401 `"This username does not exist."` — **confirmed format, just no Genius user for us** |

### Available companies (from `/api/configuration/companies`)

| Code | Name | Location |
|---|---|---|
| DEMO | Demo NG | NZ / Hamilton |
| STAFFA | STAFFORD AUSTRALIA | AU / Melbourne |
| **STAFFO** | **STAFFORD ENGINEERING** | **NZ / Hamilton** (production) |
| Work1 | SEA Test Environment | AU / Melbourne |
| Work2 | Sales Test Environment | NZ / Hamilton |
| Work3 | Purchasing Test Environment | NZ / Hamilton |
| Work4 | Production Test Environment | NZ / Hamilton |
| Work5 | Financial Test Environment | NZ / Hamilton |
| Work6 | Shop Floor Test Environment | NZ / Hamilton |
| **WORK7** | **Development Test Environment** | **NZ / Hamilton** (safest for initial test) |

---

## Draft email version

Subject: Genius API integration — need a service account

Hi [Stafford contact],

We've fully reverse-engineered the Genius REST API auth flow via your Swagger spec at `/swagger/docs/v17.1.6.3`. The contract is clear: `POST /api/auth` with `{CompanyCode, Username, Password}`, returns a Bearer token. Envelope shape matches what our adapter already expects, so no code refactor needed on our side for Stafford.

**The only thing we're missing is a Genius user account.** My AD identity (`STAFFORD\chrish`) doesn't exist as a Genius application user — I've checked all 10 company codes. We need you to provision one for the CTP integration.

Could you either:
- **Preferred:** create a dedicated service account (suggest `CTP_INTEGRATION` or similar) with read-only scope for WorkOrders, Production Tasks, Sales Orders, and Machine/Resource data, OR
- Tell us an existing Genius username we can use for initial testing?

We'd start with the `WORK7` Development Test Environment, then move to `STAFFO` for real data once we've validated the pipeline end-to-end.

Once we have the credentials, integration resumes immediately — the adapter auth work is all that's left on our side, maybe 4-6 hours of dev to add Bearer-token support.

Thanks,
Chris

---

*Appendix: Full technical narrative and dead-end attempts preserved in the git history of this file if you want to see what was tried.*
