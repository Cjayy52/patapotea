import { useEffect, useRef } from 'react';
import { multiplierAt } from '../../../shared/game-math.js';
import { useCountdown, useLiveMultiplier } from '../hooks/useLiveMultiplier.js';
import { fmtMult, shortHash } from '../lib/format.js';

/* -------------------------------------------------------------------------- */
/* Canvas renderer                                                            */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  grid: 'rgba(255,255,255,0.045)',
  gridStrong: 'rgba(255,255,255,0.075)',
  axis: 'rgba(255,45,63,0.22)',
  curve: '#ff3d4e',
  curveHot: '#ffd0d5',
  label: 'rgba(255,255,255,0.20)',
};

function createParticle(x, y, { burst = false } = {}) {
  const angle = burst ? Math.random() * Math.PI * 2 : Math.PI + (Math.random() - 0.5) * 0.9;
  const speed = burst ? 90 + Math.random() * 320 : 12 + Math.random() * 55;
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - (burst ? 0 : 10),
    life: burst ? 0.7 + Math.random() * 0.8 : 0.35 + Math.random() * 0.45,
    maxLife: 0,
    size: burst ? 1.2 + Math.random() * 2.8 : 0.7 + Math.random() * 1.8,
    hue: burst ? [2, 12, 28, 42][Math.floor(Math.random() * 4)] : [355, 0, 8][Math.floor(Math.random() * 3)],
    burst,
  };
}

function drawScene(ctx, w, h, state, offsetRef, fx, dt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = ctx.canvas.getBoundingClientRect();
  if (ctx.canvas.width !== Math.round(rect.width * dpr) || ctx.canvas.height !== Math.round(rect.height * dpr)) {
    ctx.canvas.width = Math.round(rect.width * dpr);
    ctx.canvas.height = Math.round(rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const phase = state?.phase || 'betting';
  const now = Date.now() + (offsetRef?.current || 0);
  const flyStart = state?.flyStartedAt;
  let elapsedMs = 0;
  if (flyStart) {
    const end = phase === 'crashed'
      ? (state.crashedAt || state.crashAt || now)
      : Math.min(now, state.crashAt || now);
    elapsedMs = Math.max(0, end - flyStart);
  }
  const elapsedSec = elapsedMs / 1000;
  const liveMult = elapsedSec > 0 ? multiplierAt(elapsedMs) : 1;
  const mult = phase === 'crashed' ? (state.crashPoint || liveMult) : liveMult;

  const padL = Math.max(38, w * 0.06);
  const padR = w * 0.05;
  const padT = h * 0.17;
  const padB = h * 0.145;
  const oX = padL;
  const oY = h - padB;
  const gw = Math.max(10, w - padL - padR);
  const gh = Math.max(10, h - padT - padB);

  const xOf = (t) => oX + gw * (t <= 0 ? 0 : t / (t + 3.1));
  const yOf = (m) => {
    const capped = Math.min(Math.max(m, 1), 140);
    return oY - gh * ((capped - 1) / (capped + 1.85));
  };

  /* ------------------------------- grid ------------------------------- */
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const x = oX + (gw * i) / 6;
    ctx.strokeStyle = i === 0 ? PALETTE.axis : PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(x, padT - 6);
    ctx.lineTo(x, oY);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const y = oY - (gh * i) / 4;
    ctx.strokeStyle = i === 0 ? PALETTE.axis : PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(oX, y);
    ctx.lineTo(oX + gw, y);
    ctx.stroke();
  }

  // quiet multiplier scale on the y axis
  ctx.font = '600 9px ui-monospace, Menlo, monospace';
  ctx.fillStyle = PALETTE.label;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const m of [2, 5, 10, 20, 50]) {
    const y = yOf(m);
    if (y < padT) continue;
    ctx.fillText(`${m}x`, oX - 8, y);
    ctx.strokeStyle = PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(oX - 5, y);
    ctx.lineTo(oX, y);
    ctx.stroke();
  }
  ctx.restore();

  /* ------------------------------ idle state --------------------------- */
  if (phase === 'betting' || !flyStart) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,45,63,0.16)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.moveTo(oX, oY);
    for (let i = 1; i <= 40; i++) {
      const t = i * 0.9;
      ctx.lineTo(xOf(t), yOf(1 + (t * t) * 0.045));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // runway pulse at origin
    const pulse = 0.5 + Math.sin(performance.now() / 500) * 0.5;
    ctx.beginPath();
    ctx.arc(oX, oY, 5 + pulse * 9, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,45,63,${0.05 + pulse * 0.08})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(oX, oY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3d4e';
    ctx.shadowColor = 'rgba(255,45,63,0.9)';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();
    return;
  }

  /* -------------------------------- curve ------------------------------ */
  const steps = 90;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (elapsedSec * i) / steps;
    const m = i === steps ? mult : multiplierAt(t * 1000);
    pts.push([xOf(t), yOf(m)]);
  }
  const last = pts[pts.length - 1];

  // area
  const fill = ctx.createLinearGradient(0, padT, 0, oY);
  fill.addColorStop(0, 'rgba(255,45,63,0.26)');
  fill.addColorStop(0.55, 'rgba(255,45,63,0.08)');
  fill.addColorStop(1, 'rgba(255,45,63,0.005)');
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(oX, oY);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(last[0], oY);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  // main glow path
  ctx.save();
  const stroke = ctx.createLinearGradient(oX, oY, last[0], last[1]);
  stroke.addColorStop(0, 'rgba(255,45,63,0.55)');
  stroke.addColorStop(0.55, '#ff3d4e');
  stroke.addColorStop(1, '#ff8a95');
  ctx.beginPath();
  ctx.moveTo(oX, oY);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,45,63,0.85)';
  ctx.shadowBlur = 20;
  ctx.stroke();
  ctx.restore();

  // hot leading trail
  if (pts.length > 12) {
    const trail = pts.slice(Math.max(0, pts.length - 14));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(trail[0][0], trail[0][1]);
    for (const [x, y] of trail) ctx.lineTo(x, y);
    const hot = ctx.createLinearGradient(trail[0][0], trail[0][1], last[0], last[1]);
    hot.addColorStop(0, 'rgba(255,120,130,0)');
    hot.addColorStop(0.6, 'rgba(255,180,188,0.55)');
    hot.addColorStop(1, '#fff2f3');
    ctx.strokeStyle = hot;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,90,105,0.95)';
    ctx.shadowBlur = 26;
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------- plane ------------------------------ */
  const px = last[0];
  const py = last[1];
  fx.lastPlane = { x: px, y: py };

  if (phase === 'crashed') {
    // explosion ring
    const age = Math.max(0, now - (state.crashedAt || now));
    if (age < 650) {
      const p = age / 650;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 8 + p * Math.max(60, w * 0.18), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,${Math.round(120 - p * 90)},${Math.round(90 - p * 80)},${(1 - p) * 0.75})`;
      ctx.lineWidth = 3 * (1 - p) + 0.5;
      ctx.shadowColor = 'rgba(255,45,63,0.9)';
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // sparks flowing off the wing
    if (phase === 'flying' && Math.random() < 0.85) {
      fx.particles.push(createParticle(px - 8, py + (Math.random() - 0.5) * 6));
      if (fx.particles.length > 220) fx.particles.shift();
    }

    const angle = Math.atan2(py - pts[Math.max(0, pts.length - 5)][1], px - pts[Math.max(0, pts.length - 5)][0]);
    const clamped = Math.max(-1.15, Math.min(0.18, angle));
    const scale = Math.max(1, Math.min(2.3, w / 640));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(clamped);
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(255,45,63,0.95)';
    ctx.shadowBlur = 22;

    // exhaust flame
    const flicker = 6 + Math.sin(performance.now() / 55) * 3;
    const flame = ctx.createLinearGradient(-16, 0, -16 - flicker * 1.6, 0);
    flame.addColorStop(0, 'rgba(255,220,160,0.95)');
    flame.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.beginPath();
    ctx.moveTo(-14, -2.6);
    ctx.lineTo(-14 - flicker * 1.7, 0);
    ctx.lineTo(-14, 2.6);
    ctx.closePath();
    ctx.fillStyle = flame;
    ctx.fill();

    // fuselage
    const jet = ctx.createLinearGradient(-16, -8, 16, 8);
    jet.addColorStop(0, '#8c0a16');
    jet.addColorStop(0.45, '#ff3040');
    jet.addColorStop(1, '#ffb3b9');
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.bezierCurveTo(10, -2.4, 3, -3, -2.5, -3.1);
    ctx.lineTo(-6, -10);
    ctx.lineTo(-9.6, -10);
    ctx.lineTo(-6.4, -2.6);
    ctx.lineTo(-13.5, -1.8);
    ctx.lineTo(-15.5, 0);
    ctx.lineTo(-13.5, 1.8);
    ctx.lineTo(-6.4, 2.6);
    ctx.lineTo(-9.6, 10);
    ctx.lineTo(-6, 10);
    ctx.lineTo(-2.5, 3.1);
    ctx.bezierCurveTo(3, 3, 10, 2.4, 17, 0);
    ctx.closePath();
    ctx.fillStyle = jet;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // cockpit highlight
    ctx.beginPath();
    ctx.ellipse(4.5, -0.4, 3.4, 1.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,242,0.75)';
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------ particles ---------------------------- */
  const gravity = 260;
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.life -= dt;
    if (p.life <= 0) { fx.particles.splice(i, 1); continue; }
    p.vy += (p.burst ? gravity : 35) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const alpha = Math.max(0, p.life / (p.burst ? 1 : 0.7));
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.burst ? 1 : 0.8), 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue}, 100%, ${p.burst ? 62 : 72}%, ${alpha * 0.85})`;
    ctx.fill();
  }
}

/* -------------------------------------------------------------------------- */
/* React component                                                            */
/* -------------------------------------------------------------------------- */

export function GameStage({ state, status, offsetRef, compact = false }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const fx = useRef({ particles: [], lastPlane: null, prevPhase: null, prevRound: null });
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf;
    let lastTs = performance.now();

    const frame = (ts) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const rect = canvas.getBoundingClientRect();
      const st = stateRef.current;

      // phase transitions: spawn explosion / reset particles
      const phase = st?.phase;
      if (phase !== fx.current.prevPhase || st?.roundId !== fx.current.prevRound) {
        if (phase === 'crashed' && fx.current.prevPhase === 'flying' && fx.current.lastPlane) {
          for (let i = 0; i < 64; i++) {
            fx.current.particles.push(createParticle(fx.current.lastPlane.x, fx.current.lastPlane.y, { burst: true }));
          }
        }
        if (phase === 'betting' || phase === 'flying') {
          fx.current.particles = fx.current.particles.filter((p) => p.burst);
        }
        fx.current.prevPhase = phase;
        fx.current.prevRound = st?.roundId;
      }

      try {
        drawScene(ctx, rect.width, rect.height, st, offsetRef, fx.current, dt);
      } catch {
        /* never let a rendering hiccup stop the loop */
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [offsetRef]);

  const multiplier = useLiveMultiplier(state, offsetRef);
  const phase = state?.phase || 'betting';
  const crashed = phase === 'crashed';
  const nextAt = phase === 'betting'
    ? state?.bettingEndsAt
    : phase === 'crashed'
      ? state?.nextRoundAt
      : null;
  const remaining = useCountdown(nextAt, offsetRef);

  const countdownPct = (() => {
    if (!nextAt || !state || !state.serverTime) return 0;
    const total = phase === 'betting'
      ? Math.max(1, state.bettingEndsAt - state.startedAt)
      : Math.max(1, (state.config?.crashedMs) || 4500);
    return Math.max(0, Math.min(100, (remaining / total) * 100));
  })();

  return (
    <div className={`stage ${crashed ? 'crashed' : ''} ${compact ? 'compact' : ''}`} aria-label="Crash game chart">
      <canvas ref={canvasRef} aria-hidden="true" />

      <div className="stage-top">
        <div className="stage-meta">
          {phase === 'betting' && <span className="badge amber"><span className="dot" />Place your bets</span>}
          {phase === 'flying' && <span className="badge red"><span className="dot live" />In flight</span>}
          {crashed && <span className="badge red"><span className="dot" />Crashed</span>}
          <span className="badge">#{state?.roundNo ?? '—'}</span>
          {status === 'reconnecting' && <span className="badge amber">Reconnecting…</span>}
        </div>
        {state?.seedHash && (
          <span className="stage-hash" title={`SHA-256 commitment: ${state.seedHash}`}>
            ⛓ {shortHash(state.seedHash)}
          </span>
        )}
      </div>

      <div className="multiplier-wrap">
        <div className={`multiplier ${crashed ? 'crashed' : ''} ${phase === 'betting' ? 'waiting' : ''}`}>
          {fmtMult(multiplier)}
        </div>
        <div className="multiplier-sub">
          {phase === 'betting' && 'Next round starts in'}
          {phase === 'flying' && 'Cash out before it crashes'}
          {crashed && 'Flew away at'}
        </div>

        {nextAt && phase !== 'flying' && (
          <div className="countdown" aria-live="off">
            <div className="countdown-bar">
              <div className="countdown-fill" style={{ width: `${countdownPct}%` }} />
            </div>
            <div className="countdown-row">
              <span>{phase === 'betting' ? 'Betting closes' : 'Next round'}</span>
              <strong>{(remaining / 1000).toFixed(1)}s</strong>
            </div>
          </div>
        )}
      </div>

      {crashed && (
        <div className="crash-banner">
          Flew away <strong>{fmtMult(state?.crashPoint)}</strong>
        </div>
      )}

      <div className="stage-footer">
        <span className="badge">DEMO · VIRTUAL</span>
        <span className="mono">Round #{state?.roundNo ?? '—'} · {phase === 'flying' ? 'live curve' : 'seed commitment'}</span>
      </div>

      {!state && (
        <div className="game-loading">
          <span className="spinner lg" />
          <span>Connecting to the game…</span>
        </div>
      )}
    </div>
  );
}
