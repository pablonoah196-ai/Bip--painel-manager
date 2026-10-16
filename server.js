
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");

const app = express();
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));

const required = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "SESSION_SECRET"
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Variável ausente: ${key}`);
    process.exit(1);
  }
}

app.use(session({
  name: "bip.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 4 * 60 * 60 * 1000
  }
}));

    

app.use("/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30
}));

const ranks = [
  ["CMD", "Comandante", "Alto Comando Operacional"],
  ["SUB-COM", "Sub-Comandante", "Alto Comando Operacional"],
  ["ADJ", "Adjunto de Brigada", "Alto Comando Operacional"],
  ["C.O.", "Coordenador Tático Aéreo", "Oficiais"],
  ["I.D.P.", "Instrutor de Paraquedismo", "Oficiais"],
  ["E-AT", "Especialista Aero-Tático", "Graduados"],
  ["O-P", "Operador de Salto", "Graduados"],
  ["L-A", "Líder Aero-Tático", "Graduados"],
  ["PQD", "Paraquedista", "Praças"],
  ["A-P", "Aluno de Paraquedismo", "Praças"]
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

app.get("/", (req, res) => {
  const user = req.session.user;
  const list = ranks.map(r => `
    <article class="rank">
      <b>${esc(r[0])}</b>
      <span>${esc(r[1])}</span>
      <small>${esc(r[2])}</small>
    </article>`).join("");

  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b1423">
<title>BIP Manager</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b1423;color:#edf3fc;
font:16px system-ui,sans-serif}
header,main{max-width:900px;margin:auto;padding:20px}
header{border-bottom:1px solid #30415a}
h1{font-size:25px}
p,small{color:#afc0d6}
.panel,.rank{background:#142239;border:1px solid #30445f;
border-radius:12px;padding:16px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.rank{display:grid;grid-template-columns:85px 1fr;gap:7px}
.rank small{grid-column:2}
a,button{background:#357fc1;color:white;border:0;border-radius:8px;
padding:12px 16px;text-decoration:none;display:inline-block;cursor:pointer}
@media(max-width:480px){header,main{padding:14px}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>🛡️ BIP MANAGER</h1>
<p>Central de Gestão Operacional</p></header>
<main>
<section class="panel">
<h2>Autenticação Discord</h2>
${user
  ? `<p>Conectado como <b>${esc(user.username)}</b></p>
     <form method="post" action="/logout"><button>Sair</button></form>`
  : `<a href="/auth/discord">Entrar com Discord</a>`}
</section>
<h2>Hierarquia BIP</h2>
<div class="grid">${list}</div>
<p>Versão inicial do painel. Ações administrativas reais ainda não estão ativadas.</p>
</main></body></html>`);
});

app.get("/auth/discord", (req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", process.env.DISCORD_REDIRECT_URI);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth/discord/callback", async (req, res) => {
  if (req.query.error) {
    return res.status(400).send("Autorização cancelada.");
  }

  if (!req.query.code ||
      !req.query.state ||
      req.query.state !== req.session.oauthState) {
    return res.status(400).send("Estado OAuth inválido.");
  }

  delete req.session.oauthState;

  try {
    const tokenRes = await fetch(
      "https://discord.com/api/oauth2/token",
      {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: req.query.code,
          redirect_uri: process.env.DISCORD_REDIRECT_URI
        })
      }
    );

  
if (!tokenRes.ok) {
  const erroDiscord = await tokenRes.text();
  console.error("Erro OAuth Discord:", tokenRes.status, erroDiscord);
  throw new Error("Falha na troca do código. HTTP " + tokenRes.status);
}
const token = await tokenRes.json();
    

    const userRes = await fetch(
      "https://discord.com/api/users/@me",
      {headers: {Authorization: `Bearer ${token.access_token}`}}
    );

    if (!userRes.ok) throw new Error("Falha ao consultar o usuário.");
    const discordUser = await userRes.json();

    await new Promise((resolve, reject) => {
      req.session.regenerate(err => err ? reject(err) : resolve());
    });

    req.session.user = {
      id: discordUser.id,
      username: discordUser.global_name || discordUser.username
    };

    res.redirect("/");
  } catch (err) {
    console.error("Erro OAuth:", err.message);
    res.status(500).send("Falha no login. Verifique a configuração.");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("bip.sid");
    res.redirect("/");
  });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("BIP Manager iniciado.");
});
   
