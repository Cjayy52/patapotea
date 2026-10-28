import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '../api/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { fmtCredits, fmtMult, fmtTimestamp, shortId } from '../lib/format.js';
import {
  ROUND_ALGORITHM,
  VERIFICATION_LIMITATIONS,
  verifyRoundRecord,
} from '../../../shared/verification.js';
import {
  Alert, Check, Close, Coin, History, Plane, Refresh, Shield,
} from '../components/Icons.jsx';

/* -------------------------------------------------------------------------- */
/* Round history + verification screen (public, demo-only)                    */
/* -------------------------------------------------------------------------- */

export function RoundsPage({ navigate }) {
  const toast = useToast();
  const [rounds, setRounds] = useState([]);
  const [meta, setMeta] = useState({ total: 0, hasMore: false, nextBefore: null });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const loadRounds = useCallback(async ({ silent = false, append = false, before = null } = {}) => {
    if (!silent) { setListLoading(true); setListError(null); }
    try {
      const res = await getApi().rounds(30, before);
      setRounds((prev) => (append ? [...prev, ...res.rounds] : res.rounds));
      setMeta({
        total: res.total,
        hasMore: res.hasMore,
        nextBefore: res.nextBefore,
      });
      if (!append && !selectedRef.current && res.rounds.length) {
        setSelectedId(res.rounds[0].roundId);
      }
    } catch (err) {
      if (!silent) setListError(err.message || 'Could not load round history.');
    } finally {
      if (!silent) setListLoading(false);
    }
  }, []);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  useEffect(() => {
    const timer = setInterval(() => loadRounds({ silent: true }), 12000);
    return () => clearInterval(timer);
  }, [loadRounds]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    getApi().roundDetail(selectedId)
      .then((res) => { if (!cancelled) setDetail(res.round); })
      .catch((err) => { if (!cancelled) { setDetail(null); setDetailError(err.message || 'Could not load this round.'); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function loadMore() {
    if (!meta.nextBefore) return;
    setLoadingMore(true);
    await loadRounds({ append: true, before: meta.nextBefore });
    setLoadingMore(false);
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error('Clipboard is not available in this browser.');
    }
  }

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <span className="eyebrow">Round records · DEMO</span>
          <h1 className="page-title">Round history &amp; verification</h1>
          <p className="page-sub">
            Review settled demo rounds and check that each recorded crash multiplier matches the
            seed revealed after the round.
          </p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn ghost sm" onClick={() => loadRounds()} disabled={listLoading}>
            <Refresh width={14} height={14} /> Refresh
          </button>
          <button type="button" className="btn primary sm" onClick={() => navigate('/')}>
            <Plane width={15} height={15} /> Play a round
          </button>
        </div>
      </div>

      <div className="alert info" role="note">
        <Shield />
        <span>
          <strong>Not independently audited.</strong> Demo commit-and-reveal only. A valid hash shows
          that a recorded outcome matches the revealed seed — it does not prove the seed was chosen in
          advance, and it does not establish trust in the operator.
        </span>
      </div>

      <div className="round-layout">
        <section className="panel round-history" aria-label="Settled demo rounds">
          <div className="panel-head">
            <span className="panel-title">Settled rounds</span>
            <span className="badge">{meta.total} total</span>
          </div>

          {listLoading && !rounds.length && <RoundListSkeleton />}

          {listError && (
            <div style={{ padding: 16 }}>
              <div className="alert" role="alert">
                <Alert /><span>{listError}</span>
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => loadRounds()}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {!listLoading && !listError && !rounds.length && (
            <div className="empty">
              <div className="icon"><History /></div>
              <h4>No settled rounds yet</h4>
              <p>
                Round records appear after the first flight crashes. Play a demo round and come back
                to verify it.
              </p>
              <button type="button" className="btn primary sm" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
                Play a round
              </button>
            </div>
          )}

          {!!rounds.length && (
            <div className="round-list">
              {rounds.map((r) => (
                <button
                  key={r.roundId}
                  type="button"
                  className={`round-row ${selectedId === r.roundId ? 'active' : ''}`}
                  onClick={() => setSelectedId(r.roundId)}
                  aria-pressed={selectedId === r.roundId}
                >
                  <span className="round-row-top">
                    <span className="round-no">#{r.roundNo}</span>
                    <span className={`round-crash ${r.crashPoint >= 10 ? 'high' : r.crashPoint >= 2 ? 'mid' : 'low'}`}>
                      {fmtMult(r.crashPoint)}
                    </span>
                  </span>
                  <span className="round-row-meta">
                    {fmtTimestamp(r.timestamps.crashedAt)}
                  </span>
                  <span className="round-row-foot">
                    <span>{r.stats?.betCount ?? 0} bets</span>
                    <span>·</span>
                    <span>{fmtCredits(r.stats?.staked ?? 0)} VC</span>
                    <span className="round-row-id mono">{shortId(r.roundId)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {meta.hasMore && (
            <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
              <button type="button" className="btn ghost sm block" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <span className="spinner" /> : null} Load older rounds
              </button>
            </div>
          )}
        </section>

        <section className="panel verify-panel" aria-label="Round verification details" aria-live="polite">
          {detailLoading && <DetailSkeleton />}

          {detailError && !detailLoading && (
            <div className="panel-body">
              <div className="alert" role="alert">
                <Alert /><span>{detailError}</span>
              </div>
            </div>
          )}

          {!detailLoading && !detailError && !detail && (
            <div className="empty">
              <div className="icon"><Shield /></div>
              <h4>Select a round</h4>
              <p>Choose a settled round on the left to inspect its commitment, revealed seed and timestamps.</p>
            </div>
          )}

          {detail && !detailLoading && (
            <RoundRecord detail={detail} onCopy={copy} />
          )}
        </section>
      </div>

      <ManualVerifier detail={detail} />
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Selected round record                                                      */
/* -------------------------------------------------------------------------- */

function RoundRecord({ detail, onCopy }) {
  const v = detail.verification;
  const verified = !!v?.verified;
  const cp = detail.crashPoint;

  return (
    <>
      <div className="panel-head">
        <div>
          <span className="eyebrow">Round #{detail.roundNo}</span>
          <span className="panel-title" style={{ display: 'block', marginTop: 3 }}>Verification record</span>
        </div>
        <span className={`round-crash big ${cp >= 10 ? 'high' : cp >= 2 ? 'mid' : 'low'}`}>{fmtMult(cp)}</span>
      </div>

      <div className="panel-body stack" style={{ gap: 16 }}>
        <div className={`verify-banner ${verified ? 'ok' : 'bad'}`}>
          {verified ? <Check /> : <Alert />}
          <div>
            <strong>{verified ? 'Record reproduces' : 'Could not verify this record'}</strong>
            <span>
              {verified
                ? 'The revealed seed hashes to the published commitment and regenerates the recorded crash point.'
                : 'One or more checks failed. Treat this record as unverified.'}
            </span>
          </div>
        </div>

        <dl className="kv record-kv">
          <dt>Round ID</dt>
          <dd>
            <span className="mono">{detail.roundId}</span>
            <button type="button" className="mini-copy" onClick={() => onCopy(detail.roundId, 'Round ID')}>copy</button>
          </dd>
          <dt>Algorithm</dt>
          <dd className="mono">{detail.algorithm}</dd>
          <dt>Round opened</dt>
          <dd>{fmtTimestamp(detail.timestamps.startedAt)}</dd>
          <dt>Betting closed</dt>
          <dd>{fmtTimestamp(detail.timestamps.bettingEndsAt)}</dd>
          <dt>Took off</dt>
          <dd>{fmtTimestamp(detail.timestamps.flyingAt)}</dd>
          <dt>Scheduled crash</dt>
          <dd>{fmtTimestamp(detail.timestamps.crashAt)}</dd>
          <dt>Settled</dt>
          <dd>{fmtTimestamp(detail.timestamps.crashedAt)}</dd>
          <dt>Flight duration</dt>
          <dd className="mono">
            {detail.flightDurationMs != null ? `${(detail.flightDurationMs / 1000).toFixed(2)}s` : '—'}
          </dd>
          <dt>Bets</dt>
          <dd className="mono">
            {detail.stats?.betCount ?? 0} · {fmtCredits(detail.stats?.staked ?? 0)} VC staked · {fmtCredits(detail.stats?.paid ?? 0)} VC paid
          </dd>
        </dl>

        <div className="seed-section">
          <div className="between" style={{ marginBottom: 6 }}>
            <span className="eyebrow">Commitment published before betting</span>
            <button type="button" className="mini-copy" onClick={() => onCopy(detail.seedHash, 'Commitment hash')}>copy</button>
          </div>
          <div className="seed-block">{detail.seedHash}</div>

          <div className="between" style={{ margin: '12px 0 6px' }}>
            <span className="eyebrow">Server seed revealed after the crash</span>
            <button type="button" className="mini-copy" onClick={() => onCopy(detail.serverSeed, 'Server seed')}>copy</button>
          </div>
          <div className="seed-block revealed">{detail.serverSeed || 'Not revealed'}</div>
        </div>

        {v && (
          <div className="verify-checks">
            <div className={`verify-check ${v.commitmentMatches ? 'ok' : 'bad'}`}>
              {v.commitmentMatches ? <Check /> : <Close />}
              <span>SHA-256(seed) matches the published commitment</span>
            </div>
            <div className={`verify-check ${v.crashMatches ? 'ok' : 'bad'}`}>
              {v.crashMatches ? <Check /> : <Close />}
              <span>Seed + round number regenerate the recorded crash point</span>
            </div>
            <div className="verify-derived mono">
              recomputed crash: {fmtMult(v.computedCrashPoint)} · round hash: {v.roundHash?.slice(0, 24)}…
            </div>
          </div>
        )}

        <details className="formula-details" open>
          <summary>How this outcome was generated</summary>
          <ol className="steps">
            <li>Before betting, the server published <span className="mono">seedHash = SHA-256(serverSeed)</span>.</li>
            <li>At settlement it revealed <span className="mono">serverSeed</span>, the 64-character hex value above.</li>
            <li>
              The round hash is <span className="mono">SHA-256(serverSeed + &quot;:&quot; + roundNo)</span>.
              The first 13 hex characters become <span className="mono">u = int / 2^52</span>.
            </li>
            <li>
              The crash point is <span className="mono">max(1, floor(min((1 − {ROUND_ALGORITHM.houseEdge}) / (1 − u), {ROUND_ALGORITHM.maxMultiplier}) × 100) / 100)</span>.
              The multiplier curve is <span className="mono">e^({ROUND_ALGORITHM.growthRate} × seconds)</span>.
            </li>
          </ol>
          <p className="hint" style={{ marginTop: 10 }}>
            Try it yourself in the panel below — copy the seed and round number, or edit them to see a
            failed check.
          </p>
        </details>

        <div className="limits-block">
          <div className="eyebrow" style={{ marginBottom: 6 }}>What this does not prove</div>
          <ul className="limits">
            {VERIFICATION_LIMITATIONS.slice(0, 4).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Manual, client-side verifier                                               */
/* -------------------------------------------------------------------------- */

const EMPTY_FORM = { roundNo: '', serverSeed: '', seedHash: '', crashPoint: '' };

function ManualVerifier({ detail }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [result, setResult] = useState(null);
  const [usedRound, setUsedRound] = useState(null);

  useEffect(() => {
    if (!detail) return;
    const next = {
      roundNo: String(detail.roundNo),
      serverSeed: detail.serverSeed || '',
      seedHash: detail.seedHash || '',
      crashPoint: String(detail.crashPoint ?? ''),
    };
    setForm(next);
    setUsedRound(detail.roundNo);
    // Pre-run the local check so the reproducible result is immediately visible.
    setResult(verifyRoundRecord({
      serverSeed: next.serverSeed,
      roundNo: next.roundNo,
      seedHash: next.seedHash,
      crashPoint: Number(next.crashPoint),
    }));
  }, [detail]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setResult(null);
  };

  function verify(e) {
    e.preventDefault();
    const res = verifyRoundRecord({
      serverSeed: form.serverSeed.trim(),
      roundNo: form.roundNo.trim(),
      seedHash: form.seedHash.trim() || undefined,
      crashPoint: form.crashPoint.trim() === '' ? undefined : Number(form.crashPoint),
    });
    setResult(res);
  }

  function reset() {
    setForm(EMPTY_FORM);
    setResult(null);
    setUsedRound(null);
  }

  const commitmentState = !result
    ? null
    : result.commitmentMatches === true ? 'ok' : result.commitmentMatches === false ? 'bad' : 'skip';
  const crashState = !result
    ? null
    : result.crashMatches === true ? 'ok' : result.crashMatches === false ? 'bad' : 'skip';

  return (
    <section className="panel manual-panel" aria-label="Manual round verifier">
      <div className="panel-head">
        <div>
          <span className="panel-title">Reproduce it yourself</span>
          <span className="eyebrow" style={{ display: 'block', marginTop: 3 }}>Runs locally in your browser</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {usedRound && <span className="badge">Round #{usedRound}</span>}
          <button type="button" className="btn ghost sm" onClick={reset}>Clear</button>
        </div>
      </div>

      <div className="panel-body">
        <p className="mute" style={{ fontSize: 12, marginBottom: 14, maxWidth: 760 }}>
          Paste a revealed seed, its round number, and (optionally) the recorded commitment and crash
          value. The check below uses the same SHA-256 routine and crash math as the game — no server
          round-trip is involved.
        </p>

        <form className="manual-grid" onSubmit={verify}>
          <label className="field">
            <span className="field-label">Round number</span>
            <input
              className="input mono"
              inputMode="numeric"
              value={form.roundNo}
              onChange={set('roundNo')}
              placeholder="e.g. 128"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Recorded crash multiplier</span>
            <input
              className="input mono"
              inputMode="decimal"
              value={form.crashPoint}
              onChange={set('crashPoint')}
              placeholder="e.g. 2.31"
            />
          </label>

          <label className="field full-col">
            <span className="field-label">Revealed server seed (64 hex characters)</span>
            <textarea
              className="input mono seed-input"
              rows={2}
              spellCheck={false}
              autoComplete="off"
              value={form.serverSeed}
              onChange={set('serverSeed')}
              placeholder="64-character hexadecimal seed"
              required
            />
          </label>

          <label className="field full-col">
            <span className="field-label">Published commitment hash (optional)</span>
            <textarea
              className="input mono seed-input"
              rows={2}
              spellCheck={false}
              autoComplete="off"
              value={form.seedHash}
              onChange={set('seedHash')}
              placeholder="SHA-256 of the server seed"
            />
          </label>

          <div className="full-col row wrap" style={{ gap: 10 }}>
            <button type="submit" className="btn primary" disabled={!form.serverSeed.trim() || !form.roundNo.trim()}>
              <Shield width={15} height={15} /> Verify locally
            </button>
            {result && (
              <span className="badge violet mono" style={{ letterSpacing: 0 }}>
                recomputed crash {fmtMult(result.computedCrashPoint)}
              </span>
            )}
          </div>
        </form>

        {result && (
          <div style={{ marginTop: 16 }}>
            {result.errors.length > 0 && (
              <div className="alert" role="alert" style={{ marginBottom: 12 }}>
                <Alert />
                <span>
                  {result.errors.map((err) => <span key={err} style={{ display: 'block' }}>{err}</span>)}
                </span>
              </div>
            )}

            <div className="verify-checks">
              <div className={`verify-check ${commitmentState}`}>
                {commitmentState === 'ok' ? <Check /> : commitmentState === 'bad' ? <Close /> : <Coin />}
                <span>
                  {commitmentState === 'ok' && 'Commitment hash matches the revealed seed'}
                  {commitmentState === 'bad' && 'Commitment hash does NOT match the revealed seed'}
                  {commitmentState === 'skip' && 'Commitment hash not checked (field left blank)'}
                </span>
              </div>
              <div className={`verify-check ${crashState}`}>
                {crashState === 'ok' ? <Check /> : crashState === 'bad' ? <Close /> : <Coin />}
                <span>
                  {crashState === 'ok' && 'Recorded crash multiplier matches the recomputed value'}
                  {crashState === 'bad' && 'Recorded crash multiplier does NOT match the recomputed value'}
                  {crashState === 'skip' && 'Crash multiplier not checked (field left blank)'}
                </span>
              </div>
            </div>

            {result.commitmentHash && (
              <div className="derived-row">
                <span className="eyebrow">Computed commitment</span>
                <span className="mono">{result.commitmentHash}</span>
              </div>
            )}
            {result.roundHash && (
              <div className="derived-row">
                <span className="eyebrow">Round hash</span>
                <span className="mono">{result.roundHash}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading skeletons                                                          */
/* -------------------------------------------------------------------------- */

function RoundListSkeleton() {
  return (
    <div style={{ padding: 14 }} aria-busy="true" aria-label="Loading rounds">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="skeleton" style={{ height: 62, marginBottom: 8, borderRadius: 10 }} />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="panel-body" style={{ padding: 20 }} aria-busy="true" aria-label="Loading round record">
      <div className="skeleton skeleton-line" style={{ width: '40%', height: 18 }} />
      <div className="skeleton skeleton-line" style={{ width: '70%' }} />
      <div className="skeleton skeleton-line" style={{ width: '90%' }} />
      <div className="skeleton" style={{ height: 54, marginTop: 18 }} />
      <div className="skeleton" style={{ height: 54, marginTop: 10 }} />
    </div>
  );
}
