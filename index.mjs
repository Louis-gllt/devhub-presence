import { createServer } from 'node:http';

const TOKEN = process.env.DISCORD_TOKEN;
const HEALTH_URL = process.env.DEVHUB_HEALTH_URL;
const EVENTS_URL = process.env.DEVHUB_EVENTS_URL;
const EVENTS_SECRET = process.env.CRON_SECRET;
const PORT = Number(process.env.PORT || 10000);
if (!TOKEN) {
  console.error('DISCORD_TOKEN manquant');
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

let ws;
let seq = null;
let sessionId = null;
let resumeUrl = null;
let heartbeat;
let acked = true;
let attempts = 0;
let connectedSince = null;
let health = { status: 'unknown', text: 'Démarrage…' };

function presence() {
  const status = health.status === 'ok' ? 'online' : health.status === 'error' ? 'dnd' : 'idle';
  return { since: null, afk: false, status, activities: [{ type: 4, name: 'Custom Status', state: health.text }] };
}

const timers = new Map();

async function forward(payload, attempt = 0) {
  if (!EVENTS_URL || !EVENTS_SECRET) return;
  try {
    const res = await fetch(EVENTS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${EVENTS_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(55_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.busy !== true) return;
    throw new Error(body?.error ?? (body?.busy ? 'occupé' : `HTTP ${res.status}`));
  } catch (err) {
    if (attempt < 4) setTimeout(() => forward(payload, attempt + 1), 5_000 * 2 ** attempt);
    else log(`Relais « ${payload.kind} » impossible : ${err.message}`);
  }
}

function debounced(kind, delay = 3_000) {
  clearTimeout(timers.get(kind));
  timers.set(kind, setTimeout(() => forward({ kind }), delay));
}

const user = (u) => (u ? { id: u.id, username: u.username, global_name: u.global_name ?? null, avatar: u.avatar ?? null, bot: !!u.bot } : undefined);
const emojiOf = (e) => (e?.id ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e?.name ?? '❔');

function onDispatch(t, d) {
  if (t === 'GUILD_MEMBER_ADD' || t === 'GUILD_MEMBER_REMOVE') {
    log(`${t === 'GUILD_MEMBER_ADD' ? 'Arrivée' : 'Départ'} d’un membre`);
    debounced('members');
  } else if (t === 'GUILD_AUDIT_LOG_ENTRY_CREATE') {
    debounced('audit');
  } else if (t === 'MESSAGE_CREATE' && d.guild_id && d.author && !d.author.bot && !d.webhook_id) {
    forward({ kind: 'message', channelId: d.channel_id, messageId: d.id, author: user(d.author), attachments: d.attachments?.length ?? 0 });
  } else if (t === 'MESSAGE_UPDATE' && d.guild_id && d.author && !d.author.bot && d.edited_timestamp) {
    forward({ kind: 'message', channelId: d.channel_id, messageId: d.id, author: user(d.author), edited: true });
  } else if (t === 'MESSAGE_REACTION_ADD' && d.guild_id && !d.member?.user?.bot) {
    forward({ kind: 'reaction', channelId: d.channel_id, messageId: d.message_id, userId: d.user_id, user: user(d.member?.user), emoji: emojiOf(d.emoji) });
  } else if (t === 'MESSAGE_REACTION_REMOVE' && d.guild_id) {
    forward({ kind: 'reaction', channelId: d.channel_id, messageId: d.message_id, userId: d.user_id, emoji: emojiOf(d.emoji), removed: true });
  }
}

function send(op, d) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
}

async function gatewayUrl() {
  if (resumeUrl && sessionId) return resumeUrl;
  const res = await fetch('https://discord.com/api/v10/gateway/bot', { headers: { authorization: `Bot ${TOKEN}` } });
  if (!res.ok) throw new Error(`gateway/bot HTTP ${res.status}`);
  return (await res.json()).url;
}

async function connect() {
  clearInterval(heartbeat);
  let url;
  try {
    url = await gatewayUrl();
  } catch (err) {
    return retry(err.message);
  }
  ws = new WebSocket(`${url}/?v=10&encoding=json`);
  ws.addEventListener('message', (event) => {
    const { op, d, s, t } = JSON.parse(event.data);
    if (s != null) seq = s;
    if (op === 10) {
      acked = true;
      setTimeout(() => send(1, seq), Math.random() * d.heartbeat_interval);
      heartbeat = setInterval(() => {
        if (!acked) {
          log('Heartbeat sans réponse, reconnexion');
          ws.close(4000);
          return;
        }
        acked = false;
        send(1, seq);
      }, d.heartbeat_interval);
      if (sessionId) send(6, { token: TOKEN, session_id: sessionId, seq });
      else send(2, { token: TOKEN, intents: 2 | 4 | 512 | 1024, properties: { os: 'linux', browser: 'devhub', device: 'devhub' }, presence: presence() });
    } else if (op === 11) acked = true;
    else if (op === 1) send(1, seq);
    else if (op === 7) ws.close(4000);
    else if (op === 9) {
      if (!d) {
        sessionId = null;
        resumeUrl = null;
        seq = null;
      }
      setTimeout(() => ws.close(4000), 1000 + Math.random() * 4000);
    } else if (op === 0 && t !== 'READY' && t !== 'RESUMED') {
      onDispatch(t, d);
    } else if (op === 0) {
      if (t === 'READY') {
        sessionId = d.session_id;
        resumeUrl = d.resume_gateway_url;
        log(`Connecté en tant que ${d.user.username}`);
      } else log('Session reprise');
      attempts = 0;
      connectedSince = Date.now();
      send(3, presence());
    }
  });
  ws.addEventListener('close', (event) => {
    clearInterval(heartbeat);
    connectedSince = null;
    if (FATAL.has(event.code)) {
      log(`Fermeture définitive (code ${event.code})`);
      process.exit(1);
    }
    if (event.code === 1000 || event.code === 4007 || event.code === 4009) {
      sessionId = null;
      resumeUrl = null;
      seq = null;
    }
    retry(`fermeture ${event.code}`);
  });
  ws.addEventListener('error', () => undefined);
}

function retry(reason) {
  const delay = Math.min(60_000, 1000 * 2 ** attempts++) + Math.random() * 1000;
  log(`Reconnexion dans ${Math.round(delay / 1000)} s (${reason})`);
  setTimeout(connect, delay);
}

async function refreshHealth() {
  if (!HEALTH_URL) return;
  let next;
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    const failing = Object.values(body.sources ?? {}).filter((s) => !s.ok).length;
    if (body.status === 'ok' && !failing) next = { status: 'ok', text: '👀 Surveille tes projets · tout va bien' };
    else if (failing) next = { status: 'error', text: `⚠️ ${failing} source${failing > 1 ? 's' : ''} en erreur · voir #alertes` };
    else next = { status: 'late', text: '⏳ Vérifications en retard' };
  } catch {
    next = { status: 'late', text: '⏳ État du hub indisponible' };
  }
  if (next.status !== health.status || next.text !== health.text) {
    health = next;
    send(3, presence());
    log(`Statut : ${health.text}`);
  }
}

createServer((req, res) => {
  res.writeHead(connectedSince ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ connected: !!connectedSince, since: connectedSince, health }));
}).listen(PORT, () => log(`Santé HTTP sur :${PORT}`));

process.on('SIGTERM', () => {
  ws?.close(4000);
  process.exit(0);
});

await refreshHealth();
setInterval(refreshHealth, 2 * 60_000);
connect();
