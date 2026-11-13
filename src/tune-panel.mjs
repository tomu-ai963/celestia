/**
 * tune-panel.mjs — 実機で描画の値を調整するパネル（index.html?tune=1 のときだけ読み込む）
 *
 * スライダーを動かすとその場で描画に反映する。「今の値をコピー」は、src/starlight.mjs の
 * STAR_DEFAULTS・BINOCULAR・BLOOM_DEFAULTS の {…} にそのまま貼れる JSON をクリップボードに出す。
 * 値は保存しない（再読み込みで既定に戻る）。
 *
 * api は index.html の tuneApi() が作る: { defaults, values(), set(group, key, v), state() }
 */

/** 調整する値。step はスライダーの刻みで、コピーする値の桁もこれに合わせる */
const SLIDERS = [
  { sec: '星', g: 'STAR_DEFAULTS', k: 'magWhite', label: '露出 m_white（肉眼）', min: 1, max: 6, step: 0.05 },
  { sec: '星', g: 'BINOCULAR', k: 'magWhite', label: '露出 m_white（双眼鏡）', min: 2, max: 7.5, step: 0.05 },
  { sec: '星', g: 'STAR_DEFAULTS', k: 'peakMax', label: 'ピークの頭打ち P_max', min: 1, max: 16, step: 0.1 },
  { sec: '星', g: 'STAR_DEFAULTS', k: 'sigmaFloor', label: 'σ0 の下限（実画素）', min: 0.4, max: 2, step: 0.05 },
  { sec: '星', g: 'STAR_DEFAULTS', k: 'sigmaPerPx', label: 'σ0 の pixelRatio 比例分', min: 0.3, max: 1.5, step: 0.05 },
  { sec: 'ブルーム（Q2）', g: 'BLOOM_DEFAULTS', k: 'strength', label: '強さ strength', min: 0, max: 1.5, step: 0.01 },
  { sec: 'ブルーム（Q2）', g: 'BLOOM_DEFAULTS', k: 'radius', label: '半径 radius', min: 0, max: 1, step: 0.01 },
  { sec: 'ブルーム（Q2）', g: 'BLOOM_DEFAULTS', k: 'threshold', label: '閾値 threshold', min: 0.2, max: 4, step: 0.05 },
  { sec: '光芒（Q1・Q0）', g: 'STAR_DEFAULTS', k: 'halo', label: '光芒の強さ uHalo', min: 0, max: 1, step: 0.01 },
  { sec: '天の川', g: 'STAR_DEFAULTS', k: 'mwGain', label: '明るさ mwGain（肉眼）', min: 0, max: 0.2, step: 0.001 },
  { sec: '天の川', g: 'BINOCULAR', k: 'mwGain', label: '明るさ mwGain（双眼鏡）', min: 0, max: 0.3, step: 0.001 },
  { sec: 'トーンカーブ', g: 'STAR_DEFAULTS', k: 'knee', label: '折れ点 knee', min: 0.3, max: 0.95, step: 0.01 },
];

const CSS = `
#tune{position:fixed;z-index:20;top:calc(64px + env(safe-area-inset-top,0px));
  right:max(12px,env(safe-area-inset-right,0px));width:300px;max-width:calc(100vw - 24px);
  max-height:calc(100vh - 120px);overflow:auto;-webkit-overflow-scrolling:touch;
  background:rgba(8,11,20,.88);border:1px solid rgba(217,180,95,.35);border-radius:8px;
  color:#dfe7f2;font:12px/1.5 'JetBrains Mono',ui-monospace,monospace;padding:10px 12px;
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:pan-y}
#tune.closed .tn-body{display:none}
#tune header{display:flex;justify-content:space-between;align-items:center;gap:8px}
#tune h2{font-size:12px;font-weight:500;line-height:1.4;color:#d9b45f;letter-spacing:.08em;margin:0}
#tune button{font:inherit;color:#dfe7f2;background:rgba(217,180,95,.12);border:1px solid rgba(217,180,95,.4);
  border-radius:4px;padding:5px 10px;cursor:pointer;touch-action:manipulation}
#tune button:focus-visible,#tune input:focus-visible{outline:2px solid #d9b45f;outline-offset:2px}
#tune h3{font-size:11px;font-weight:500;line-height:1.4;color:rgba(223,231,242,.55);margin:12px 0 4px}
#tune .tn-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0}
#tune,#tune *{letter-spacing:normal}
#tune .tn-row label{font-size:12px;color:rgba(223,231,242,.85)}
#tune .tn-row output{font-variant-numeric:tabular-nums;color:#d9b45f}
/* ページ全体の input の見た目（下線だけ）を打ち消して、溝とつまみを描き直す。つまみは指で掴める大きさ */
#tune input[type=range]{grid-column:1/-1;width:100%;margin:0;padding:0;height:28px;border:none;
  background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}
#tune input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:rgba(217,180,95,.35)}
#tune input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7.5px;
  border-radius:50%;background:#d9b45f;border:2px solid #0b0e17}
#tune input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:rgba(217,180,95,.35)}
#tune input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#d9b45f;border:2px solid #0b0e17}
/* スマホ: 上側に寄せ、高さを画面の 4 割までにして空を残す */
@media (max-width:600px){
  #tune{left:max(12px,env(safe-area-inset-left,0px));right:max(12px,env(safe-area-inset-right,0px));width:auto;
    top:calc(52px + env(safe-area-inset-top,0px));max-height:42vh;padding:8px 10px}
  #tune h3{margin-top:8px}
  #tune .tn-row{margin:2px 0}
}
#tune .tn-row.changed label::after{content:' *';color:#d9b45f}
#tune .tn-state{color:rgba(223,231,242,.55);margin-top:8px;white-space:pre-line}
#tune .tn-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#tune .tn-msg{min-height:1.5em;margin-top:6px;color:rgba(223,231,242,.7)}
#tune textarea{width:100%;height:9em;margin-top:6px;font-family:inherit;font-size:11px;line-height:1.4;color:#dfe7f2;
  background:rgba(0,0,0,.4);border:1px solid rgba(217,180,95,.3);border-radius:4px;resize:vertical}
`;

/** 刻みの桁で丸める（0.1 + 0.2 のような端数をコピーに出さない） */
const decimals = step => (String(step).split('.')[1] || '').length;
const round = (v, step) => Number(v.toFixed(decimals(step)));

export function mountTunePanel(api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('aside');
  root.id = 'tune';
  root.setAttribute('aria-label', '描画の値の調整');
  root.innerHTML = `<header><h2>TUNE</h2><button type="button" id="tnToggle" aria-expanded="true">たたむ</button></header>
    <div class="tn-body"><div id="tnSliders"></div><div class="tn-state" id="tnState"></div>
    <div class="tn-actions"><button type="button" id="tnCopy">今の値をコピー</button>
    <button type="button" id="tnReset">既定に戻す</button></div>
    <div class="tn-msg" id="tnMsg" role="status"></div>
    <textarea id="tnOut" readonly hidden aria-label="今の値（JSON）"></textarea></div>`;
  document.body.appendChild(root);

  const box = root.querySelector('#tnSliders');
  const value = s => api.values()[s.g][s.k];
  const def = s => (s.g === 'BINOCULAR' && !(s.k in api.defaults.BINOCULAR) ? api.defaults.STAR_DEFAULTS : api.defaults[s.g])[s.k];
  const rows = [];
  let sec = null;
  SLIDERS.forEach((s, i) => {
    if (s.sec !== sec) { sec = s.sec; const h = document.createElement('h3'); h.textContent = sec; box.appendChild(h); }
    const row = document.createElement('div');
    row.className = 'tn-row';
    const id = `tn${i}`;
    row.innerHTML = `<label for="${id}"></label><output for="${id}"></output>
      <input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}">`;
    row.querySelector('label').textContent = s.label;
    const input = row.querySelector('input'), out = row.querySelector('output');
    const show = v => {
      out.textContent = v.toFixed(decimals(s.step));
      row.classList.toggle('changed', v !== def(s));
    };
    input.value = String(value(s)); show(value(s));
    input.addEventListener('input', () => {
      const v = round(Number(input.value), s.step);
      api.set(s.g, s.k, v); show(v); showState();
    });
    rows.push({ s, input, show });
    box.appendChild(row);
  });

  const elState = root.querySelector('#tnState'), elMsg = root.querySelector('#tnMsg'), elOut = root.querySelector('#tnOut');
  function showState() {
    const st = api.state();
    elState.textContent = `品質 Q${st.q}${st.bloom ? '（ブルームあり）' : ''} · ${st.deep ? '双眼鏡の空' : '肉眼'}\n` +
      `σ0 = ${st.sigma0.toFixed(3)} 実画素（pixelRatio ${st.pixelRatio}）\n` +
      (st.q === 2 ? '光芒は Q1・Q0 だけ（URL に &q=1 で確認）' : 'ブルームは Q2 だけ（URL に &q=2 で確認）');
  }
  showState();
  setInterval(showState, 1000);            // 双眼鏡の切り替えや自動の品質の段階の変化を拾う

  const json = () => JSON.stringify(api.values(), null, 2);
  root.querySelector('#tnCopy').addEventListener('click', () => {
    const text = json();
    elOut.value = text; elOut.hidden = false;
    const fallback = () => {
      elOut.focus(); elOut.select();
      elMsg.textContent = 'クリップボードに書けませんでした。下の欄を選択してコピーしてください';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => { elMsg.textContent = 'コピーしました（src/starlight.mjs の各 {…} に貼れます）'; })
        .catch(fallback);
    } else fallback();
  });
  root.querySelector('#tnReset').addEventListener('click', () => {
    for (const r of rows) {
      const v = def(r.s);
      api.set(r.s.g, r.s.k, v); r.input.value = String(v); r.show(v);
    }
    showState();
    elMsg.textContent = '既定の値に戻しました';
  });
  const tg = root.querySelector('#tnToggle');
  tg.addEventListener('click', () => {
    const closed = root.classList.toggle('closed');
    tg.textContent = closed ? 'ひらく' : 'たたむ';
    tg.setAttribute('aria-expanded', String(!closed));
  });
}
