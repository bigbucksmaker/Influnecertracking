"use client";

import { useState } from "react";

export interface Rates {
  rateQuoteTweet: number | null;
  ratePost: number | null;
  rateRetweet: number | null;
  rateThread: number | null;
}

function num(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function RatesEditor({
  username,
  initial,
  onSave,
  onClose,
}: {
  username: string;
  initial: Rates;
  onSave: (r: Rates) => Promise<void> | void;
  onClose: () => void;
}) {
  const [qt, setQt] = useState(initial.rateQuoteTweet?.toString() ?? "");
  const [post, setPost] = useState(initial.ratePost?.toString() ?? "");
  const [rt, setRt] = useState(initial.rateRetweet?.toString() ?? "");
  const [th, setTh] = useState(initial.rateThread?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        rateQuoteTweet: num(qt),
        ratePost: num(post),
        rateRetweet: num(rt),
        rateThread: num(th),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-900">Rates — @{username}</h3>
        <p className="mt-0.5 text-xs text-slate-500">USD per deliverable. Leave blank to clear.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Quote tweet" value={qt} onChange={setQt} />
          <Field label="Post" value={post} onChange={setPost} />
          <Field label="Retweet" value={rt} onChange={setRt} />
          <Field label="Thread" value={th} onChange={setTh} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label} ($)</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums"
      />
    </label>
  );
}
