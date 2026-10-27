// BAYORA — Scenario Dossier: the drill-in page behind each 3D card.
// Every scenario gets its OWN dedicated view: metadata, editable payload,
// live dispatch, verdict, wire diff, and that scenario's sealed events.
// Nothing shared — the dossier is fully scoped to one scenario.

import { useRef, useState, useCallback, useEffect } from 'react';
import { evaluatePrompt, fetchLedger, type LedgerEvent, type EvaluateResult } from '../utils/api';
import { sound } from '../utils/audio';

export interface ScenarioData {
  id: string;
  name: string;
  prompt: string;
  targetOutcome: string;
  httpCode: number;
  rule: string;
  pillar: string;
  vector?: string;
  control?: string;
  detection?: string;
}

interface ScenarioDossierProps {
  scenario: ScenarioData;
  onBack: () => void;
}

const OUTCOME_THEME: Record<string, { text: string; border: string; bg: string }> = {
  QUARANTINED: { text: 'text-amber-300', border: 'border-amber-400/40', bg: 'bg-amber-400/10' },
  BLOCKED: { text: 'text-red-400', border: 'border-red-400/40', bg: 'bg-red-400/10' },
  DENIED: { text: 'text-red-400', border: 'border-red-400/40', bg: 'bg-red-400/10' },
  REJECTED: { text: 'text-red-400', border: 'border-red-400/40', bg: 'bg-red-400/10' },
  REDACTED: { text: 'text-cyan-300', border: 'border-cyan-400/40', bg: 'bg-cyan-400/10' },
  ALLOWED: { text: 'text-emerald-300', border: 'border-emerald-400/40', bg: 'bg-emerald-400/10' },
  ERROR: { text: 'text-red-400', border: 'border-red-400/40', bg: 'bg-red-400/10' },
};

function theme(outcome: string) {
  return OUTCOME_THEME[outcome] ?? OUTCOME_THEME.ALLOWED;
}

export function ScenarioDossier({ scenario, onBack }: ScenarioDossierProps) {
  const [payload, setPayload] = useState(scenario.prompt);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);

  // pull this scenario's sealed events on mount + after each dispatch
  const refreshEvents = useCallback(async () => {
    const { events: all } = await fetchLedger(200);
    setEvents(all.filter((e) => e.scenario_id === scenario.id));
  }, [scenario.id]);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  const dispatch = async () => {
    sound.playClick();
    setEvaluating(true);
    setResult(null);
    const isBlock = scenario.id === 'SC-01b';
    const res = await evaluatePrompt(payload, scenario.id, isBlock);
    setEvaluating(false);
    setResult(res);
    if (['REDACTED', 'BLOCKED', 'ALLOWED', 'DETECTED'].includes(res.outcome)) sound.playVerified();
    else sound.playTamperAlert();
    await refreshEvents();
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const th = theme(result?.outcome ?? scenario.targetOutcome.split(' ')[0]);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Dossier header — prominent back control */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
        <div className="space-y-1.5 min-w-0">
          <button
            onClick={() => { sound.playClick(); onBack(); }}
            className="group inline-flex items-center gap-2 text-[10px] font-mono tracking-widest px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-neutral-300 hover:text-white hover:border-cyan-400/50 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span className="text-cyan-400 group-hover:-translate-x-0.5 transition-transform">&larr;</span>
            <span>ALL SCENARIOS</span>
          </button>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-tight">
            {scenario.id} / {scenario.name}
          </h2>
          <div className="text-[10px] text-neutral-500 font-mono">{scenario.pillar}</div>
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-1 rounded border font-bold tracking-widest ${th.text} ${th.border} ${th.bg}`}>
          TARGET: {scenario.targetOutcome.split(' ')[0]}
        </span>
      </div>

      {/* Spec strip: this scenario's own metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10px]">
        {[
          ['VECTOR', scenario.vector ?? scenario.name],
          ['CONTROL', scenario.control ?? scenario.rule],
          ['DETECTION', scenario.detection ?? scenario.rule],
          ['EXPECTED HTTP', String(scenario.httpCode)],
        ].map(([k, v]) => (
          <div key={k} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/10 space-y-1">
            <span className="text-neutral-500 uppercase tracking-wider block">{k}</span>
            <span className="text-neutral-200 block leading-snug break-words">{v}</span>
          </div>
        ))}
      </div>

      {/* THIS scenario's payload editor */}
      <div className="p-4 rounded-xl border border-white/10 bg-black/50 space-y-2">
        <div className="text-[11px] text-neutral-400 flex items-center justify-between">
          <span className="font-bold text-white">PAYLOAD / {scenario.id}</span>
          <span className="text-neutral-500 font-mono text-[9px]">EDITABLE / ARBITRARY INPUT WELCOME</span>
        </div>
        <textarea
          rows={3}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className="w-full text-xs text-neutral-200 bg-neutral-900/90 p-3 rounded-lg border border-white/10 font-mono focus:outline-none focus:border-cyan-400 resize-none"
        />
        <button
          disabled={evaluating}
          onClick={dispatch}
          className="w-full py-3 rounded-lg bg-white text-black font-bold text-xs tracking-wider hover:bg-neutral-200 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {evaluating
            ? `DISPATCHING ${scenario.id} THROUGH THE BROKER...`
            : `DISPATCH ${scenario.id} / LIVE BROKER`}
        </button>
      </div>

      {/* Verdict: this scenario's own result */}
      {result && (
        <div ref={resultRef} className={`p-4 rounded-xl border space-y-3 animate-in fade-in duration-300 ${theme(result.outcome).border} ${theme(result.outcome).bg}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <span className={`text-sm font-black tracking-tight ${theme(result.outcome).text}`}>
              VERDICT: {result.outcome}
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              HTTP {result.httpStatus} / {result.policyReason} / {result.timing}
              {result.matchedPatterns && result.matchedPatterns.length > 0 && (
                <span className="text-cyan-300/80"> / matched: {result.matchedPatterns.join(', ')}</span>
              )}
              {result.rawBehavior && (
                <span className="text-amber-300/80"> / behavior: {result.rawBehavior}</span>
              )}
            </span>
          </div>

          {/* Wire diff — raw target output vs broker-released wire */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="p-3 rounded-lg bg-black/60 border border-red-400/20 space-y-1.5">
              <span className="text-[9px] text-red-300/80 font-bold tracking-widest block">RAW TARGET OUTPUT / PRE-EGRESS</span>
              <span className="text-rose-200 font-mono block break-words leading-relaxed">
                {result.rawTargetOutput.split(/(BAYORA-CANARY-[a-z0-9-]+)/gi).map((part, i) =>
                  /BAYORA-CANARY-/i.test(part)
                    ? <span key={i} className="text-red-400 font-bold">{part}</span>
                    : part
                )}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-black/60 border border-emerald-400/20 space-y-1.5">
              <span className="text-[9px] text-emerald-300/80 font-bold tracking-widest block">
                RELEASED WIRE / POST-ENFORCEMENT{result.redactionApplied ? ' / CANARY REDACTED' : ''}
              </span>
              <span className="text-emerald-200 font-mono block break-words leading-relaxed">{result.releasedText}</span>
            </div>
          </div>

          {/* This scenario's sealed events */}
          <div className="pt-1 space-y-1.5">
            <span className="text-[9px] text-neutral-500 font-bold tracking-widest block">
              SEALED EVENTS FOR {scenario.id} / {events.length} IN LEDGER
            </span>
            <div className="max-h-32 overflow-y-auto space-y-1 pr-1 overscroll-contain">
              {events.length === 0 && (
                <span className="text-[10px] text-neutral-600 italic">none yet — dispatch to seal some</span>
              )}
              {events.slice().reverse().map((ev) => (
                <div key={String(ev.seq || Math.random())} className="flex items-center justify-between gap-3 text-[10px] font-mono px-2 py-1 rounded bg-black/40 border border-white/5">
                  <span className="text-neutral-500 shrink-0">#{ev.seq} {ev.event_type}</span>
                  <span className="text-neutral-600 truncate hidden md:block">{(ev.ts || '').slice(11, 19)}Z</span>
                  <span className="text-neutral-600 truncate hidden sm:block">{ev.hash?.slice(0, 24)}</span>
                  <span className={`shrink-0 font-bold ${ev.outcome ? theme(ev.outcome).text : 'text-neutral-500'}`}>{ev.outcome ?? 'sealed'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!result && (
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] text-[11px] text-neutral-500 font-mono italic">
          No verdict yet for {scenario.id}. Dispatch above — the broker on this machine decides, and the events seal into the real ledger.
        </div>
      )}
    </div>
  );
}
