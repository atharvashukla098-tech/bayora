// BAYORA — Pillar Case Study v2: a cinematic, dedicated case page.
// Real-time 3D hero (CanaryVault — glowing core sealed in an armor cage,
// mouse-reactive, reacts to dispatch outcomes), editorial asymmetric layout,
// designed dispatch states. Contains ONLY this pillar's content; no
// cross-pillar navigation exists inside.

import { useState, useRef, useEffect, useCallback } from 'react';
import { evaluatePrompt, fetchLedger, type LedgerEvent, type EvaluateResult } from '../utils/api';
import { sound } from '../utils/audio';
import { CanaryVault } from './CanaryVault';

export interface PillarData {
  id: string;
  scenarioId: string;
  title: string;
  category: string;
  tag: string;
  desc: string;
  image?: string;
  vector: string;
  control: string;
  detection: string;
  expectedOutcome: string;
  httpCode: number;
  defaultPrompt: string;
}

interface PillarCaseStudyProps {
  pillar: PillarData;
  onClose: () => void;
}

type VaultMode = 'idle' | 'dispatching' | 'blocked' | 'redacted' | 'allowed';

const OUTCOME_COLOR: Record<string, string> = {
  REDACTED: 'text-cyan-300',
  BLOCKED: 'text-red-400',
  DENIED: 'text-red-400',
  DETECTED: 'text-amber-300',
  QUARANTINED: 'text-amber-300',
  ALLOWED: 'text-emerald-300',
  ERROR: 'text-red-400',
};

export function PillarCaseStudy({ pillar, onClose }: PillarCaseStudyProps) {
  const [payload, setPayload] = useState(pillar.defaultPrompt);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [runs, setRuns] = useState(0);
  const [vaultMode, setVaultMode] = useState<VaultMode>('idle');
  const [showDragHint, setShowDragHint] = useState(true);
  const verdictRef = useRef<HTMLDivElement>(null);

  const refreshEvents = useCallback(async () => {
    const { events: all } = await fetchLedger(200);
    setEvents(all.filter((e) => e.scenario_id === pillar.scenarioId));
  }, [pillar.scenarioId]);

  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { sound.playClick(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
    return () => { if (header) header.style.display = ''; };
  }, []);

  const dispatch = async () => {
    if (evaluating) return;
    sound.playClick();
    setEvaluating(true);
    setResult(null);
    setVaultMode('dispatching');
    const isBlock = pillar.scenarioId === 'SC-01b';
    const res = await evaluatePrompt(payload, pillar.scenarioId, isBlock);
    setEvaluating(false);
    setResult(res);
    setRuns((n) => n + 1);
    const v: VaultMode =
      res.outcome === 'BLOCKED' ? 'blocked'
      : res.outcome === 'REDACTED' ? 'redacted'
      : res.outcome === 'ALLOWED' ? 'allowed'
      : 'dispatching';
    setVaultMode(v);
    if (v === 'blocked') sound.playTamperAlert();
    else if (v === 'redacted' || v === 'allowed') sound.playVerified();
    await refreshEvents();
    setTimeout(() => verdictRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  };

  const resultColor = result ? (OUTCOME_COLOR[result.outcome] ?? 'text-white') : '';

  return (
    <div className="fixed inset-0 z-[60] bg-[#06070a] animate-in fade-in duration-300">
      {/* real-time 3D stage — the canary vault */}
      <CanaryVault mode={vaultMode} onFirstGrab={() => setShowDragHint(false)} />

      {/* drag affordance — fades on first grab */}
      <div className={`pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 z-20 font-mono text-[9px] tracking-[0.35em] text-neutral-400/70 uppercase transition-opacity duration-1000 ${showDragHint ? 'opacity-100' : 'opacity-0'}`}>
        drag to spin the vault / arrow keys work too
      </div>

      {/* CASE CHROME — minimal, floats over the 3D */}
      <div className="absolute top-0 inset-x-0 z-20 px-5 sm:px-10 py-5 flex items-center justify-between pointer-events-none">
        <div className="flex items-baseline gap-4 pointer-events-auto">
          <span className="font-mono text-[10px] tracking-[0.3em] text-cyan-400/80">CASE {pillar.id}</span>
          <span className="hidden sm:block font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{pillar.category}</span>
        </div>
        <button
          onClick={() => { sound.playClick(); onClose(); }}
          className="pointer-events-auto group flex items-center gap-3 font-mono text-[10px] tracking-[0.25em] text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <span className="text-cyan-400/70">ESC</span>
          <span className="relative">
            CLOSE
            <span className="absolute -bottom-1 left-0 w-0 group-hover:w-full bg-cyan-400/60 h-px transition-all duration-300" />
          </span>
        </button>
      </div>

      {/* THE PAGE — scrollable content layered over the 3D; pointer-events
          pass through empty space so the vault can be grabbed and spun */}
      <div className="absolute inset-0 z-10 overflow-y-auto pointer-events-none">
        <div className="min-h-full max-w-6xl mx-auto px-5 sm:px-10 pt-24 sm:pt-32 pb-16 pointer-events-auto">

          {/* 01 — TITLE BLOCK: oversized, editorial, left-anchored */}
          <header className="space-y-6 mb-28">
            <div className="font-mono text-[10px] tracking-[0.35em] text-neutral-500 uppercase">
              Scenario {pillar.scenarioId} / {pillar.tag}
            </div>
            <h1 className="font-sans font-bold tracking-[-0.03em] leading-[0.93] text-white text-[clamp(3.4rem,10vw,8rem)] max-w-5xl">
              {pillar.title.split(' : ').map((line, i, arr) => (
                <span key={i} className={`block ${i === arr.length - 1 ? 'text-cyan-300' : ''}`}>
                  {line}{i === arr.length - 1 ? '.' : ''}
                </span>
              ))}
            </h1>
            <p className="text-sm sm:text-base text-neutral-400 leading-relaxed max-w-xl">
              {pillar.desc}
            </p>
            <div className="font-mono text-[10px] tracking-[0.25em] text-neutral-600 uppercase pt-2">
              {pillar.expectedOutcome} / HTTP {pillar.httpCode} / {runs} run{runs === 1 ? '' : 's'} this session
            </div>
          </header>

          {/* 02 — THE FIRING LINE: payload floats over the 3D stage */}
          <section className="mb-32 relative">
            <div className="grid grid-cols-12 gap-6 items-end">
              <div className="col-span-12 lg:col-span-5 space-y-4">
                <div className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">
                  Adversarial payload
                </div>
                <textarea
                  rows={4}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  spellCheck={false}
                  className="w-full text-[13px] leading-relaxed text-neutral-200 bg-black/60 backdrop-blur-sm p-4 border-l-2 border-cyan-400/60 font-mono focus:outline-none focus:border-cyan-300 resize-none"
                />
                <button
                  disabled={evaluating}
                  onClick={dispatch}
                  className={`w-full py-4 font-mono text-xs tracking-[0.3em] uppercase transition-all duration-300 cursor-pointer ${
                    evaluating
                      ? 'bg-amber-400/10 text-amber-300 border border-amber-400/40'
                      : result
                      ? 'bg-white/10 text-neutral-400 border border-white/15'
                      : 'bg-cyan-300 text-black font-bold hover:bg-white'
                  }`}
                >
                  {evaluating ? (
                    <span className="flex items-center justify-center gap-3">
                      <span className="w-1.5 h-1.5 bg-amber-300 rounded-full animate-pulse" />
                      running the gauntlet
                    </span>
                  ) : result ? (
                    'dispatch again'
                  ) : (
                    'dispatch'
                  )}
                </button>
                <div className="font-mono text-[9px] text-neutral-600 tracking-wider">
                  fires the live broker at 127.0.0.1:8000 / every run seals into the real ledger
                </div>
              </div>
            </div>
          </section>

          {/* 03 — VERDICT: the cinematic moment */}
          <section ref={verdictRef} className="mb-32">
            {evaluating && (
              <div className="border-l-2 border-amber-400/60 pl-6 py-2 font-mono text-xs text-amber-300/90 tracking-widest">
                the payload is inside the broker — the gates are evaluating it now
              </div>
            )}
            {result && !evaluating && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
                <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                  <span className={`font-sans font-bold tracking-tight leading-none ${resultColor} text-[clamp(2.2rem,5vw,3.8rem)]`}>
                    {result.outcome}.
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500 tracking-widest">
                    HTTP {result.httpStatus} / {result.policyReason}
                  </span>
                </div>

                {/* wire diff: raw vs released — rules and type, not boxes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
                  <div className="border-l-2 border-red-400/50 pl-5 space-y-2">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-red-300/60 uppercase">
                      what the model tried to say
                    </div>
                    <div className="font-mono text-[12px] text-rose-200/90 leading-relaxed break-words">
                      {result.rawTargetOutput.split(/(BAYORA-CANARY-[a-z0-9-]+)/gi).map((part, i) =>
                        /BAYORA-CANARY-/i.test(part)
                          ? <span key={i} className="text-red-400 font-bold">{part}</span>
                          : part
                      )}
                    </div>
                  </div>
                  <div className="border-l-2 border-emerald-400/50 pl-5 space-y-2">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-emerald-300/60 uppercase">
                      what left the wire
                    </div>
                    <div className="font-mono text-[12px] text-emerald-200/90 leading-relaxed break-words">
                      {result.releasedText}
                    </div>
                  </div>
                </div>

                {/* sealed trail */}
                {events.length > 0 && (
                  <div className="pt-8 border-t border-white/10 space-y-3 max-w-2xl">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-neutral-600 uppercase">
                      sealed trail / {pillar.scenarioId} / {events.length} events
                    </div>
                    <div className="space-y-1.5">
                      {events.slice(-6).reverse().map((ev) => (
                        <div key={String(ev.seq || Math.random())} className="flex items-baseline gap-4 font-mono text-[10px]">
                          <span className="text-neutral-600 w-7 shrink-0">#{ev.seq}</span>
                          <span className="text-neutral-400 flex-1 truncate">{ev.event_type.replace('.', ' · ')}</span>
                          <span className="text-neutral-700 hidden sm:block">{(ev.ts || '').slice(11, 23)}Z</span>
                          <span className={`${ev.outcome ? (OUTCOME_COLOR[ev.outcome] ?? 'text-neutral-500') : 'text-neutral-500'} w-20 text-right shrink-0`}>
                            {ev.outcome?.toLowerCase() ?? 'sealed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!result && !evaluating && (
              <div className="border-l-2 border-white/15 pl-6 py-2 font-mono text-xs text-neutral-500 tracking-wider">
                the vault is live — dispatch to see what the broker does with this payload
              </div>
            )}
          </section>

          {/* 04 — SPEC: editorial definition list, no card grid */}
          <section className="pb-24">
            <div className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase mb-8">
              Enforcement specification
            </div>
            <dl className="divide-y divide-white/10">
              {[
                ['attack vector', pillar.vector],
                ['control under test', pillar.control],
                ['detection mechanism', pillar.detection],
                ['expected outcome', `${pillar.expectedOutcome} — HTTP ${pillar.httpCode}`],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-12 gap-4 py-5">
                  <dt className="col-span-4 sm:col-span-3 font-mono text-[10px] tracking-[0.25em] text-neutral-500 uppercase pt-0.5">
                    {k}
                  </dt>
                  <dd className="col-span-8 sm:col-span-9 text-sm text-neutral-200 leading-relaxed">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

        </div>
      </div>

      {/* vignette — keeps text legible over the 3D, open around the vault */}
      <div className="pointer-events-none absolute inset-0 z-[5]"
        style={{ background: 'radial-gradient(120% 90% at 32% 18%, transparent 28%, rgba(6,7,10,0.78) 70%, #06070a 100%)' }} />
    </div>
  );
}
