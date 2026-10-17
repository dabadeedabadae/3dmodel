'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { TEMPLATES, TEMPLATE_KEYS, type TemplateKey } from './templates';
import type { Garment } from './types';

// 3D scene is client-only — SSR would crash on `window`.
const Scene = dynamic(() => import('./Scene'), {
  ssr: false,
  loading: () => <div className="model-loading">Loading 3D scene…</div>,
});

const PALETTE = ['#1f3ff0', '#c4282d', '#15803d', '#a16207', '#7c3aed', '#1d1e23', '#e2e8f0', '#db2777'];

let counter = 0;
const uid = () => `g_${Date.now().toString(36)}_${counter++}`;
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

export default function ModelDemo() {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickType, setPickType] = useState<TemplateKey>('tshirt');

  const selected = useMemo(() => garments.find((g) => g.id === selectedId) ?? null, [garments, selectedId]);

  function addGarment(type: string, color = randomColor()) {
    const g: Garment = { id: uid(), type, color };
    setGarments((prev) => [...prev, g]);
    setSelectedId(g.id);
  }

  function removeGarment(id: string) {
    setGarments((prev) => prev.filter((g) => g.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  function recolor(id: string, color: string) {
    setGarments((prev) => prev.map((g) => (g.id === id ? { ...g, color } : g)));
  }

  function addByPhoto() {
    alert('Потом добавим');
  }

  return (
    <main className="model-main">
      <figure className="model-viewport">
        <span className="fig-label fig-label-left">FIG_3D</span>
        <span className="fig-label fig-label-right">[ Drag to rotate ]</span>
        <div className="model-canvas">
          <Scene garments={garments} selectedId={selectedId} />
        </div>
      </figure>

      <aside className="model-panel">
        <h1>Model demo</h1>

        <section className="model-section">
          <h2>01. Add garment</h2>
          <div className="model-add">
            <select value={pickType} onChange={(e) => setPickType(e.target.value as TemplateKey)}>
              {TEMPLATE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {TEMPLATES[k].label} · {TEMPLATES[k].zone}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => addGarment(pickType)}>
              Add
            </button>
          </div>
          <button className="secondary model-photo-btn" onClick={addByPhoto}>
            + Add from photo
          </button>
        </section>

        <section className="model-section">
          <h2>02. Wardrobe ({garments.length})</h2>
          <ul className="model-list">
            {garments.map((g) => (
              <li key={g.id} className={g.id === selectedId ? 'is-selected' : undefined}>
                <button className="model-item" onClick={() => setSelectedId(g.id)}>
                  <span className="model-swatch" style={{ backgroundColor: g.color }} />
                  <span className="model-item-label">{TEMPLATES[g.type]?.label ?? g.type}</span>
                  <span className="model-item-zone">{TEMPLATES[g.type]?.zone}</span>
                </button>
                <button
                  className="model-remove"
                  aria-label={`Remove ${TEMPLATES[g.type]?.label ?? g.type}`}
                  onClick={() => removeGarment(g.id)}
                >
                  ✕
                </button>
              </li>
            ))}
            {garments.length === 0 && <li className="model-empty">Nothing added yet.</li>}
          </ul>
        </section>

        <section className="model-section">
          <h2>03. Colour</h2>
          {selected ? (
            <div className="model-color">
              <input type="color" value={selected.color} onChange={(e) => recolor(selected.id, e.target.value)} />
              <span>
                {TEMPLATES[selected.type]?.label} — {selected.color}
              </span>
            </div>
          ) : (
            <p className="model-empty">Select a garment to recolour.</p>
          )}
        </section>
      </aside>
    </main>
  );
}
