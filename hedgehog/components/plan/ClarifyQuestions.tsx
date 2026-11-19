"use client";
// "Quick questions" card shown before the quote is built, and the "Based on your answers" recap on the plan.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ClarifyAnswer, ClarifyQuestion } from "@/lib/types";
import { answersRecap } from "@/lib/ai/clarifyRules";
import s from "./Clarify.module.css";

const IDLE_SECONDS = 45;

type Draft = { choice: string | null; text: string; skipped: boolean };

function initialDraft(q: ClarifyQuestion, prev?: ClarifyAnswer): Draft {
  if (!prev?.answer) return { choice: null, text: "", skipped: false };
  return q.options.includes(prev.answer) ? { choice: prev.answer, text: "", skipped: false } : { choice: null, text: prev.answer, skipped: false };
}

export function ClarifyQuestions({ questions, previous = [], onSubmit, onCancel, name }: {
  questions: ClarifyQuestion[];
  previous?: ClarifyAnswer[];
  onSubmit: (answers: ClarifyAnswer[]) => void;
  /** Editing answers on an existing plan: shows "Cancel" and turns off auto-continue. */
  onCancel?: () => void;
  name?: string;
}) {
  const uid = useId();
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map((q) => initialDraft(q, previous.find((a) => a.questionId === q.id))));
  const [left, setLeft] = useState(IDLE_SECONDS);
  const done = useRef(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const auto = !onCancel;

  const collect = useCallback((ds: Draft[]): ClarifyAnswer[] => questions.flatMap((q, i) => {
    const d = ds[i];
    const answer = d && !d.skipped ? (d.text.trim() || d.choice || "") : "";
    return answer ? [{ questionId: q.id, question: q.question, answer, ...(q.label ? { label: q.label } : {}) }] : [];
  }), [questions]);

  const submit = useCallback((answers: ClarifyAnswer[]) => {
    if (done.current) return;
    done.current = true;
    onSubmit(answers);
  }, [onSubmit]);

  // Never trap the owner: after ~45 s without a tap or keystroke, continue with whatever is answered.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setLeft((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, [auto]);
  useEffect(() => { if (auto && left <= 0) submit(collect(draftsRef.current)); }, [auto, left, submit, collect]);
  useEffect(() => { headRef.current?.focus(); }, []);

  const touch = () => setLeft(IDLE_SECONDS);
  const update = (i: number, patch: Partial<Draft>) => { touch(); setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d))); };
  const answered = collect(drafts).length;

  return (
    <div className={`card ${s.card}`} onKeyDown={touch} onPointerDown={touch}>
      <div className={`doc-head ${s.head}`}>
        <span className="caps-title">Quick questions</span>
        <button type="button" className={s.headBtn} onClick={() => (onCancel ? onCancel() : submit([]))}>{onCancel ? "Cancel" : "Skip all"}</button>
      </div>
      <h2 className={s.title} ref={headRef} tabIndex={-1}>{name ? `A few things about ${name}` : "A few things first"}</h2>
      <ol className={s.qs}>
        {questions.map((q, i) => {
          const d = drafts[i];
          const qid = `${uid}-q${i}`;
          return (
            <li key={q.id}>
              <fieldset className={s.q} data-skipped={d.skipped} aria-describedby={q.why ? `${qid}-why` : undefined}>
                <legend className={s.ask} id={qid}>{q.question}</legend>
                <button type="button" className={s.skip} aria-pressed={d.skipped} onClick={() => update(i, d.skipped ? { skipped: false } : { skipped: true, choice: null, text: "" })}>
                  {d.skipped ? "Undo skip" : "Skip"}
                </button>
                {q.why && <span className={s.why} id={`${qid}-why`}>{q.why}</span>}
                {q.options.length > 0 && (
                  <div className={`chips ${s.chips}`} role="group" aria-labelledby={qid}>
                    {q.options.map((o) => (
                      <button key={o} type="button" className="chip" aria-pressed={!d.skipped && d.choice === o && !d.text.trim()}
                        onClick={() => update(i, { choice: d.choice === o && !d.text.trim() ? null : o, text: "", skipped: false })}>{o}</button>
                    ))}
                  </div>
                )}
                {q.allowFreeText && (
                  <div className={s.free}>
                    <input className="input" type="text" maxLength={120} value={d.text} aria-label={`${q.question} (type your own answer)`}
                      placeholder={q.options.length ? "Or type it" : "Your answer"}
                      onChange={(e) => update(i, { text: e.target.value, skipped: false })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(collect(drafts)); } }} />
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className={s.foot}>
        <button type="button" className="btn btn-primary" onClick={() => submit(collect(drafts))}>
          {answered ? "Continue" : "Continue without answers"}
        </button>
        {auto && <span className="xs muted" aria-live="off">Continues in {Math.max(0, left)}s</span>}
      </div>
    </div>
  );
}

/** "Based on your answers: Outdoor seating: Mostly · Own vehicles: Yes, 3 vans · Edit answers" */
export function ClarifyRecap({ answers, asked, onEdit, busy }: { answers?: ClarifyAnswer[]; asked: boolean; onEdit: () => void; busy?: boolean }) {
  const recap = answersRecap(answers);
  if (!recap && !asked) return null;
  return (
    <p className={s.recap}>
      {recap ? <span>Based on your answers: <b>{recap}</b></span> : <span>You skipped the quick questions.</span>}
      <button type="button" className={s.recapEdit} onClick={onEdit} disabled={busy}>{recap ? "Edit answers" : "Answer them"}</button>
    </p>
  );
}
