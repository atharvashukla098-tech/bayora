// BAYORA — Scenario World: the dedicated full-screen 3D page opened by one
// pillar card. The scene is built FROM that card's reference image, and the
// REAL backend action for that scenario plays as the 3D choreography.
// ESC always returns to the site. No world-to-world navigation exists.

import { useState, useRef, useEffect, useCallback } from 'react';
import { evaluatePrompt, checkDestination, fetchLedger, type LedgerEvent, type EvaluateResult } from '../utils/api';
import { sound } from '../utils/audio';
import { ScenarioScene } from './ScenarioScene';

export interface ScenarioWorldData {
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

interface ScenarioWorldProps {
  scenario: ScenarioWorldData;
  onClose: () => void;
}

type SceneMode = 'idle' | 'dispatching' | 'detected' | 'blocked' | 'redacted' | 'allowed' | 'denied';

const OUTCOME_COLOR: Record<string, string> = {
  REDACTED: 'text-cyan-300',
  BLOCKED: 'text-red-400',
  DENIED: 'text-red-400',
  DETECTED: 'text-amber-300',
  QUARANTINED: 'text-amber-300',
  ALLOWED: 'text-emerald-300',
  ERROR: 'text-red-400',
};

export function ScenarioWorld({ scenario, onClose }: ScenarioWorldProps) {
  const [payload, setPayload] = useState(scenario.defaultPrompt);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [runs, setRuns] = useState(0);
  const [sceneMode, setSceneMode] = useState<SceneMode>('idle');
  const [showHint, setShowHint] = useState(true);
  const verdictRef = useRef<HTMLDivElement>(null);

  const refreshEvents = useCallback(async () => {
    const { events: all } = await fetchLedger(200);
    setEvents(all.filter((e) => e.scenario_id === scenario.scenarioId));
  }, [scenario.scenarioId]);

  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { sound.playClick(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    // wheel-anywhere: the 3D canvas sits behind the scroll container
    // (pointer-events-none), so wheel events over bare canvas die there.
    // Catch them at the document level and route them to the world scroller.
    const onWheel = (e: WheelEvent) => {
      const scroller = document.querySelector('.world-scroll') as HTMLElement | null;
      if (!scroller) return;
      // if the cursor is over the scrollable panel tree, native scroll handles it
      if (e.target instanceof Element && e.target.closest('.world-scroll')) return;
      // don't hijack scrolling of any other scrollable element (textareas etc.)
      if (e.target instanceof HTMLElement) {
        const t = e.target.closest('textarea, [contenteditable="true"]');
        if (t) return;
      }
      scroller.scrollTop += e.deltaY;
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
    return () => { if (header) header.style.display = ''; };
  }, []);

  const dispatch = async (e?: React.MouseEvent) => {
    if (evaluating) return;
    // prevent focus auto-scroll from yanking the scroller to the button
    (e?.currentTarget as HTMLButtonElement | undefined)?.blur();
    sound.playClick();
    setEvaluating(true);
    setResult(null);
    setSceneMode('dispatching');
    const isBlock = scenario.scenarioId === 'SC-01b';
    if (scenario.scenarioId === 'SC-03') {
      // SSRF probes go through the REAL destination-allowlist route (D20):
      // a socket is never built; 403 comes back from the live broker.
      const d = await checkDestination(payload.trim());
      setEvaluating(false);
      setRuns((n) => n + 1);
      setResult({
        runId: 'egress-check',
        scenarioId: scenario.scenarioId,
        outcome: d.allowed ? 'ALLOWED' : 'BLOCKED',
        httpStatus: d.httpStatus,
        policyReason: d.policyReason,
        releasedText: d.detail,
        rawTargetOutput: payload.trim(),
        redactionApplied: false,
        events: [],
        timing: 'POLICY-ONLY ROUTE / NO SOCKET BUILT',
      });
      setSceneMode(d.allowed ? 'allowed' : 'blocked');
      sound.playVerified();
      await refreshEvents();
      return;
    }
    const res = await evaluatePrompt(payload, scenario.scenarioId, isBlock);
    setEvaluating(false);
    setResult(res);
    setRuns((n) => n + 1);
    const oc = (res.outcome || '') as string;
    const v = (oc === 'BLOCKED' || oc === 'DENIED'
      ? 'blocked'
      : oc === 'REDACTED' ? 'redacted'
      : oc === 'ALLOWED' ? 'allowed'
      : oc === 'DETECTED' || oc === 'QUARANTINED' ? 'detected'
      : 'idle') as SceneMode;
    setSceneMode(v);
    if (v === 'blocked') sound.playTamperAlert();
    else if (v === 'redacted' || v === 'allowed' || v === 'detected') sound.playVerified();
    await refreshEvents();
    // keep the hero WORLD in view when the verdict lands — the 3D scene IS
    // the verdict's visual. The verdict panel sits one scroll below; the
    // user scrolls to read details after watching the world react.
    setTimeout(() => {
      const scroller = document.querySelector('.world-scroll');
      (scroller as HTMLElement | null)?.scrollTo({ top: 0, behavior: 'instant' });
    }, 250);
    setTimeout(() => {
      const scroller = document.querySelector('.world-scroll');
      (scroller as HTMLElement | null)?.scrollTo({ top: 0, behavior: 'instant' });
    }, 900); // re-assert: the focused button must not yank the hero away
  };

  const resultColor = result ? (OUTCOME_COLOR[result.outcome] ?? 'text-white') : '';

  return (
    <div className="fixed inset-0 z-[70] bg-black animate-in fade-in duration-300">
      {/* THE 3D WORLD — built from this scenario's reference */}
      <ScenarioScene scenarioId={scenario.scenarioId} mode={sceneMode} onFirstGrab={() => setShowHint(false)} />

      {/* chrome — solid backdrop so scrolled dossier content passes UNDER
          the case label instead of through it */}
      <div className="absolute top-0 inset-x-0 z-20 px-5 sm:px-10 py-5 flex items-center justify-between pointer-events-none bg-black/85 border-b border-white/10 backdrop-blur-sm">
        <div className="flex items-baseline gap-4 pointer-events-auto">
          <span className="font-mono text-[10px] tracking-[0.3em] text-cyan-400/80">CASE {scenario.id}</span>
          <span className="hidden sm:block font-mono text-[10px] tracking-[0.3em] text-neutral-400 uppercase">{scenario.category}</span>
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

      {/* scrollable content over the world — wheel events land on the panel
          wrapper below, which re-enables pointer events, so this scrolls
          everywhere except over the interactive text/inputs themselves */}
      <div className="world-scroll absolute inset-0 z-10 overflow-y-auto overscroll-contain pointer-events-none">
        <div className="pointer-events-auto absolute inset-x-0 top-0 h-14" aria-hidden="true" />
        <div className="min-h-full max-w-6xl mx-auto px-5 sm:px-10 pt-24 sm:pt-32 pb-16 pointer-events-auto">

          {/* title block */}
          <header className="space-y-5 mb-40 max-w-4xl relative">
            {/* Clean directional scrim for crisp typography contrast without muddy blur blotches */}
            <div className="absolute -inset-x-8 -inset-y-4 -z-10 bg-gradient-to-r from-black/65 via-black/25 to-transparent pointer-events-none rounded-xl" />

            <div className="font-mono text-[10px] tracking-[0.35em] text-neutral-400 uppercase">
              Scenario {scenario.scenarioId} / {scenario.tag}
            </div>
            <h1 className="font-sans font-bold tracking-[-0.03em] leading-[1.04] text-white text-[clamp(2.8rem,8vw,6.5rem)] drop-shadow-[0_4px_16px_rgba(0,0,0,0.65)]">
              {scenario.title.split(' : ').map((line, i, arr) => (
                <span key={i} className={`block ${i === arr.length - 1 ? 'text-cyan-300' : ''}`}>
                  {line}{i === arr.length - 1 ? '.' : ''}
                </span>
              ))}
            </h1>
            <p className="text-sm sm:text-base text-neutral-200 leading-relaxed max-w-xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
              {scenario.desc}
            </p>
            <div className="font-mono text-[10px] tracking-[0.25em] text-neutral-400 uppercase pt-1">
              {scenario.expectedOutcome} / HTTP {scenario.httpCode} / {runs} run{runs === 1 ? '' : 's'} this session
            </div>
          </header>

          {/* firing line: the payload floats over the world */}
          <section className="mb-44 relative">
            <div className="max-w-md space-y-4"
              style={{ background: 'rgba(4,6,10,0.55)', backdropFilter: 'blur(6px)', padding: '1.25rem', borderRadius: '4px' }}>
              <div className="font-mono text-[10px] tracking-[0.3em] text-neutral-400 uppercase">
                Adversarial payload
              </div>
              <textarea
                rows={3}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                spellCheck={false}
                className="w-full text-[13px] leading-relaxed text-neutral-100 bg-black/50 p-3.5 border-l-2 border-cyan-400/70 font-mono focus:outline-none focus:border-cyan-300 resize-none"
              />
              <button
                disabled={evaluating}
                onClick={dispatch}
                className={`w-full py-3.5 font-mono text-xs tracking-[0.3em] uppercase transition-all duration-300 cursor-pointer ${
                  evaluating
                    ? 'bg-amber-400/10 text-amber-300 border border-amber-400/40'
                    : result
                    ? 'bg-white/10 text-neutral-300 border border-white/20'
                    : 'bg-cyan-300 text-black font-bold hover:bg-white'
                }`}
              >
                {evaluating ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-1.5 h-1.5 bg-amber-300 rounded-full animate-pulse" />
                    firing at the {scenario.tag.toLowerCase()}
                  </span>
                ) : result ? 'fire again' : 'fire'}
              </button>
              <div className="font-mono text-[9px] text-neutral-500 tracking-wider">
                live broker 127.0.0.1:8000 / the scene reacts to the real verdict
              </div>
            </div>
          </section>

          {/* verdict */}
          <section ref={verdictRef} className="mb-44" style={{ background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(8px)', padding: '2rem', borderRadius: '6px' }}>
            {evaluating && (
              <div className="border-l-2 border-amber-400/70 pl-5 py-2 font-mono text-xs text-amber-300 tracking-widest">
                the payload is inside — watch the world respond
              </div>
            )}
            {result && !evaluating && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-9">
                <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                  <span className={`font-sans font-bold tracking-tight leading-none ${resultColor} text-[clamp(2.4rem,5vw,4rem)]`}>
                    {result.outcome}.
                  </span>
                  <span className="font-mono text-[11px] text-neutral-400 tracking-widest">
                    HTTP {result.httpStatus} / {result.policyReason}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
                  <div className="border-l-2 border-red-400/50 pl-5 space-y-2">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-red-300/70 uppercase">
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
                    <div className="font-mono text-[9px] tracking-[0.3em] text-emerald-300/70 uppercase">
                      what left the wire
                    </div>
                    <div className="font-mono text-[12px] text-emerald-200/90 leading-relaxed break-words">
                      {result.releasedText}
                    </div>
                  </div>
                </div>
                {events.length > 0 && (
                  <div className="pt-7 border-t border-white/10 space-y-3 max-w-2xl">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-neutral-500 uppercase">
                      sealed trail / {scenario.scenarioId} / {events.length} events
                    </div>
                    <div className="space-y-1.5">
                      {events.slice(-6).reverse().map((ev) => (
                        <div key={String(ev.seq || Math.random())} className="flex items-baseline gap-4 font-mono text-[10px]">
                          <span className="text-neutral-500 w-7 shrink-0">#{ev.seq}</span>
                          <span className="text-neutral-400 flex-1 truncate">{ev.event_type.replace('.', ' · ')}</span>
                          <span className="text-neutral-600 hidden sm:block">{(ev.ts || '').slice(11, 23)}Z</span>
                          <span className={`${ev.outcome ? (OUTCOME_COLOR[ev.outcome] ?? 'text-neutral-400') : 'text-neutral-500'} w-20 text-right shrink-0`}>
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
              <div className="border-l-2 border-white/20 pl-5 py-2 font-mono text-xs text-neutral-400 tracking-wider">
                the world is live — fire the payload and watch what the {scenario.tag.toLowerCase()} does with it
              </div>
            )}
          </section>

          {/* spec */}
          <section className="pb-24" style={{ background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(8px)', padding: '2rem', borderRadius: '6px' }}>
            <div className="font-mono text-[10px] tracking-[0.3em] text-neutral-400 uppercase mb-7">
              Enforcement specification
            </div>
            <dl className="divide-y divide-white/10">
              {[
                ['attack vector', scenario.vector],
                ['control under test', scenario.control],
                ['detection mechanism', scenario.detection],
                ['expected outcome', `${scenario.expectedOutcome} — HTTP ${scenario.httpCode}`],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-12 gap-4 py-4">
                  <dt className="col-span-4 sm:col-span-3 font-mono text-[10px] tracking-[0.25em] text-neutral-500 uppercase pt-0.5">
                    {k}
                  </dt>
                  <dd className="col-span-8 sm:col-span-9 text-sm text-neutral-100 leading-relaxed">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

        </div>
      </div>

      {/* drag hint */}
      <div className={`pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 z-20 font-mono text-[9px] tracking-[0.35em] text-white/50 uppercase transition-opacity duration-1000 ${showHint ? 'opacity-100' : 'opacity-0'}`}>
        drag to orbit the world
      </div>
    </div>
  );
}
