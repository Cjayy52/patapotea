/**
 * PATAPOTEA server bootstrap.
 *
 * DEMO / VIRTUAL CREDITS ONLY. This build has no payment integration, no real
 * wagering and no withdrawal path. See docs/REAL_MONEY_READINESS.md.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, SqliteRepo, seedDemoAccounts } from './db.js';
import { CrashEngine } from './game/engine.js';
import { createApp } from './app.js';
import { CONFIG } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/patapotea.db');
const IS_PROD = process.env.NODE_ENV === 'production';

const db = createDatabase(DB_PATH);
const repo = new SqliteRepo(db);

// First boot: create the demo admin, a demo player, and simulated bot accounts.
const created = seedDemoAccounts(repo, {
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
  playerPassword: process.env.SEED_PLAYER_PASSWORD,
});

const engine = new CrashEngine({ repo, bots: CONFIG.botsEnabled });

const app = createApp({ repo, engine, isProd: IS_PROD });
const server = http.createServer(app);
server.requestTimeout = 20000;
server.headersTimeout = 25000;

engine.start();

const purge = setInterval(() => repo.purgeExpiredSessions(), 60 * 60 * 1000);
purge.unref();

server.listen(PORT, () => {
  console.log('');
  console.log('  ██████╗  █████╗ ████████╗ █████╗ ██████╗  ██████╗ ████████╗███████╗ █████╗');
  console.log('  ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗');
  console.log('  ██████╔╝███████║   ██║   ███████║██████╔╝██║   ██║   ██║   █████╗  ███████║');
  console.log('  ██╔═══╝ ██╔══██║   ██║   ██╔══██║██╔═══╝ ██║   ██║   ██║   ██╔══╝  ██╔══██║');
  console.log('  ██║     ██║  ██║   ██║   ██║  ██║██║     ╚██████╔╝   ██║   ███████╗██║  ██║');
  console.log('  ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝      ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝');
  console.log('');
  console.log(`  Crash game server ready → http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log('  Mode: DEMO / VIRTUAL CREDITS ONLY — no real money, no cash value.');
  if (created.length) {
    console.log('');
    console.log('  Seeded demo accounts:');
    for (const acct of created) {
      console.log(`    ${acct.role.padEnd(6)}  ${acct.email.padEnd(32)}  ${acct.password}`);
    }
    console.log('  (change these via SEED_ADMIN_PASSWORD / SEED_PLAYER_PASSWORD before any deployment)');
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[patapotea] ${signal} received — shutting down.`);
  engine.stop();
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
