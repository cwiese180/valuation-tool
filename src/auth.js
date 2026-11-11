"use strict";
const {
  randomBytes,
  createHash,
  timingSafeEqual,
  createPublicKey,
  verify,
} = require("node:crypto");
const { HttpError } = require("./service");
const { demoUser } = require("./fixtures");
const random = () => randomBytes(32).toString("base64url");
function equal(a, b) {
  const x = Buffer.from(String(a || "")),
    y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookie(req, name) {
  return (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
}
class Auth {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.flows = new Map();
    this.keys = null;
    this.keysUntil = 0;
    this.demoCode = config.demoCode || random();
    if (!["demo", "entra"].includes(config.mode))
      throw Error("AUTH_MODE must be demo or entra");
    if (config.mode === "entra") {
      if (
        !/^[0-9a-f-]{36}$/i.test(config.tenantId || "") ||
        !config.clientId ||
        !config.clientSecret ||
        !config.access ||
        !config.origin.startsWith("https://")
      )
        throw Error(
          "Entra requires tenant, client, secret, explicit access mapping and HTTPS origin",
        );
    } else if (
      !["127.0.0.1", "localhost", "::1"].includes(
        new URL(config.origin).hostname,
      )
    )
      throw Error("Demo authentication is restricted to loopback");
  }
  setSession(res, user, expires = Date.now() + 8 * 3600000) {
    if (this.sessions.size >= 10000)
      throw new HttpError(503, "Session capacity reached");
    const token = random(),
      csrf = random();
    this.sessions.set(token, { user, csrf, expires });
    res.setHeader(
      "Set-Cookie",
      "brwa_session=" +
        token +
        "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
        Math.max(0, Math.floor((expires - Date.now()) / 1000)) +
        (this.config.mode === "entra" ? "; Secure" : ""),
    );
    return { user, csrf };
  }
  user(req) {
    const token = cookie(req, "brwa_session"),
      session = this.sessions.get(token);
    if (!session || session.expires <= Date.now()) {
      this.sessions.delete(token);
      throw new HttpError(401, "Sign in required");
    }
    if (this.config.mode === "entra") {
      const grant = this.config.access[session.user.id];
      if (
        !grant ||
        grant.role !== session.user.role ||
        JSON.stringify(grant.clients) !== JSON.stringify(session.user.clients)
      )
        throw new HttpError(401, "Access changed; sign in again");
    }
    return session;
  }
  csrf(req) {
    const s = this.user(req);
    if (!equal(req.headers["x-csrf-token"], s.csrf))
      throw new HttpError(403, "Invalid request token");
  }
  loginDemo(res, code) {
    if (this.config.mode !== "demo" || !equal(code, this.demoCode))
      throw new HttpError(401, "Invalid access code");
    return this.setSession(res, demoUser);
  }
  logout(req, res) {
    this.sessions.delete(cookie(req, "brwa_session"));
    res.setHeader(
      "Set-Cookie",
      "brwa_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" +
        (this.config.mode === "entra" ? "; Secure" : ""),
    );
  }
  authorize(res) {
    if (this.config.mode !== "entra")
      throw new HttpError(404, "Entra not configured");
    for (const [key, value] of this.flows)
      if (value.created < Date.now() - 600000) this.flows.delete(key);
    if (this.flows.size >= 1000)
      throw new HttpError(429, "Too many sign-in attempts");
    const state = random(),
      nonce = random(),
      verifier = random();
    this.flows.set(state, { nonce, verifier, created: Date.now() });
    res.setHeader(
      "Set-Cookie",
      "brwa_flow=" +
        state +
        "; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
    );
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.origin + "/auth/callback",
      response_mode: "query",
      scope: "openid profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    return (
      "https://login.microsoftonline.com/" +
      this.config.tenantId +
      "/oauth2/v2.0/authorize?" +
      params
    );
  }
  async callback(req, res, url) {
    const state = url.searchParams.get("state"),
      flow = this.flows.get(state);
    this.flows.delete(state);
    if (
      !flow ||
      !equal(cookie(req, "brwa_flow"), state) ||
      flow.created < Date.now() - 600000
    )
      throw new HttpError(401, "Invalid sign-in state");
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError(401, "Sign-in unsuccessful");
    const r = await fetch(
      "https://login.microsoftonline.com/" +
        this.config.tenantId +
        "/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: "authorization_code",
          code,
          code_verifier: flow.verifier,
          redirect_uri: this.config.origin + "/auth/callback",
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    if (!r.ok) throw new HttpError(401, "Identity exchange failed");
    const tokens = await r.json();
    const claims = await this.validate(tokens.id_token, flow.nonce);
    const grant = this.config.access[claims.oid];
    if (
      !grant ||
      !["reader", "valuer", "reviewer", "admin"].includes(grant.role) ||
      !Array.isArray(grant.clients)
    )
      throw new HttpError(403, "No application access assigned");
    this.setSession(
      res,
      {
        id: claims.oid,
        tenant: this.config.tenantId,
        name: claims.name || claims.oid,
        role: grant.role,
        clients: grant.clients,
      },
      claims.exp * 1000,
    );
  }
  async validate(token, nonce) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw Error();
      const header = JSON.parse(Buffer.from(parts[0], "base64url")),
        claims = JSON.parse(Buffer.from(parts[1], "base64url"));
      if (header.alg !== "RS256" || !header.kid) throw Error();
      if (
        !this.keys ||
        Date.now() > this.keysUntil ||
        !this.keys.some((k) => k.kid === header.kid)
      ) {
        const r = await fetch(
          "https://login.microsoftonline.com/" +
            this.config.tenantId +
            "/discovery/v2.0/keys",
          { signal: AbortSignal.timeout(15000) },
        );
        if (!r.ok) throw Error();
        this.keys = (await r.json()).keys;
        this.keysUntil = Date.now() + 3600000;
      }
      const jwk = this.keys.find(
        (k) => k.kid === header.kid && k.kty === "RSA" && k.use === "sig",
      );
      if (
        !jwk ||
        !verify(
          "RSA-SHA256",
          Buffer.from(parts[0] + "." + parts[1]),
          createPublicKey({ key: jwk, format: "jwk" }),
          Buffer.from(parts[2], "base64url"),
        )
      )
        throw Error();
      const issuer =
        "https://login.microsoftonline.com/" + this.config.tenantId + "/v2.0";
      if (
        claims.iss !== issuer ||
        claims.tid !== this.config.tenantId ||
        claims.aud !== this.config.clientId ||
        !Number.isFinite(claims.exp) ||
        claims.exp * 1000 <= Date.now() ||
        !Number.isFinite(claims.nbf) ||
        claims.nbf * 1000 > Date.now() + 60000 ||
        !claims.oid ||
        !equal(claims.nonce, nonce)
      )
        throw Error();
      if (
        jwk.issuer &&
        jwk.issuer.replace("{tenantid}", this.config.tenantId) !== issuer
      )
        throw Error();
      return claims;
    } catch {
      throw new HttpError(401, "Invalid identity token");
    }
  }
}
module.exports = { Auth, equal, cookie };
