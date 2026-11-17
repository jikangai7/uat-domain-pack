#!/usr/bin/env node
/*
 * pairwise.js — PICT形式のモデルからペアワイズ（2因子網羅）の組み合わせを作る。
 * 外部ライブラリ不要（Node.js だけで動く）。PICT が使える環境ではそちらを優先してよい。
 *
 * 使い方:
 *   node tools/pairwise.js <model.txt> [--format tsv|csv|md] [--seed 1]
 *                          [--include must.tsv] [--verify]
 *
 * モデルの書き方（PICTと同じ）:
 *   接続: NDC, EDIFACT, LCC直接
 *   在庫: アロット, リアルタイム
 *   IF [接続] = "LCC直接" THEN [在庫] <> "アロット";
 *
 * 対応している制約: IF ... THEN ... [ELSE ...]; と条件だけの制約
 *   比較: =  <>  IN {"a","b"}  NOT IN {...}   論理: AND OR NOT ( )
 * --include: 必ず入れたい組み合わせ（TSV、1行目は列名、空欄は自動で埋める）
 */
'use strict';
const fs = require('fs');

// ---------- 引数 ----------
const args = process.argv.slice(2);
const opt = { format: 'tsv', seed: 1, include: null, verify: false };
let modelPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--format') opt.format = args[++i];
  else if (a === '--seed') opt.seed = parseInt(args[++i], 10);
  else if (a === '--include') opt.include = args[++i];
  else if (a === '--verify') opt.verify = true;
  else if (a === '-h' || a === '--help') { usage(0); }
  else modelPath = a;
}
function usage(code) {
  console.error('usage: node tools/pairwise.js <model.txt> [--format tsv|csv|md] [--seed N] [--include must.tsv] [--verify]');
  process.exit(code);
}
if (!modelPath) usage(1);

// ---------- モデル解析 ----------
const text = fs.readFileSync(modelPath, 'utf8').replace(/^﻿/, '');
const lines = text.split(/\r?\n/).map(l => l.replace(/#.*$/, '')); // # 以降はコメント
const params = []; // {name, values[]}
let constraintText = '';
let inConstraints = false;
for (const raw of lines) {
  const l = raw.trim();
  if (!l) continue;
  if (!inConstraints && /^(IF\b|\[|NOT\b|\()/i.test(l)) inConstraints = true;
  if (inConstraints) { constraintText += ' ' + l; continue; }
  const m = l.match(/^([^:]+):(.*)$/);
  if (!m) fail(`パラメータ行として読めません: ${l}`);
  const name = m[1].trim();
  const values = m[2].split(',').map(v => unquote(v.trim())).filter(v => v !== '');
  if (values.length === 0) fail(`値がありません: ${name}`);
  if (params.some(p => p.name === name)) fail(`パラメータ名が重複: ${name}`);
  if (new Set(values).size !== values.length) fail(`値が重複: ${name}`);
  params.push({ name, values });
}
if (params.length < 2) fail('パラメータは2つ以上必要です');
const pIndex = new Map(params.map((p, i) => [p.name, i]));

function unquote(s) { return s.replace(/^"(.*)"$/, '$1'); }
function fail(msg) { console.error('エラー: ' + msg); process.exit(2); }

// --- 制約のトークン化と構文解析 ---
function tokenize(s) {
  const toks = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') { const j = s.indexOf(']', i); if (j < 0) fail('] がありません'); toks.push({ t: 'param', v: s.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (c === '"') { const j = s.indexOf('"', i + 1); if (j < 0) fail('" が閉じていません'); toks.push({ t: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    if (s.startsWith('<>', i)) { toks.push({ t: 'op', v: '<>' }); i += 2; continue; }
    if ('=(){},;'.includes(c)) { toks.push({ t: c === '=' ? 'op' : c, v: c }); i++; continue; }
    const m = s.slice(i).match(/^[^\s\[\]"=<>(){},;]+/);
    if (m) {
      const w = m[0]; const up = w.toUpperCase();
      if (['IF', 'THEN', 'ELSE', 'AND', 'OR', 'NOT', 'IN'].includes(up)) toks.push({ t: up, v: up });
      else toks.push({ t: 'str', v: w }); // 引用符なしの値も許す
      i += w.length; continue;
    }
    fail(`制約を読めません: ${s.slice(i, i + 20)}`);
  }
  return toks;
}

function parseConstraints(s) {
  const toks = tokenize(s); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const expect = t => { const k = next(); if (!k || k.t !== t) fail(`制約の書式: ${t} が必要`); return k; };
  function expr() { let l = andE(); while (peek() && peek().t === 'OR') { next(); const r = andE(); l = { k: 'or', l, r }; } return l; }
  function andE() { let l = notE(); while (peek() && peek().t === 'AND') { next(); const r = notE(); l = { k: 'and', l, r }; } return l; }
  function notE() { if (peek() && peek().t === 'NOT') { next(); return { k: 'not', e: notE() }; } return atom(); }
  function atom() {
    const k = peek();
    if (!k) fail('制約が途中で終わっています');
    if (k.t === '(') { next(); const e = expr(); expect(')'); return e; }
    const prm = expect('param').v;
    if (!pIndex.has(prm)) fail(`制約に未定義のパラメータ: [${prm}]`);
    const pi = pIndex.get(prm);
    let neg = false;
    if (peek() && peek().t === 'NOT') { next(); neg = true; }
    if (peek() && peek().t === 'IN') {
      next(); expect('{'); const set = [];
      while (peek() && peek().t !== '}') { const v = next(); if (v.t === ',') continue; if (v.t !== 'str') fail('IN の値が読めません'); set.push(checkVal(pi, v.v)); }
      expect('}');
      const e = { k: 'in', pi, set: new Set(set) };
      return neg ? { k: 'not', e } : e;
    }
    if (neg) fail('NOT の後には IN が必要です');
    const op = expect('op').v;
    const v = next(); if (!v || v.t !== 'str') fail('比較する値が読めません（[P] = [Q] は未対応）');
    return { k: op === '=' ? 'eq' : 'ne', pi, v: checkVal(pi, v.v) };
  }
  function checkVal(pi, v) {
    if (!params[pi].values.includes(v)) fail(`[${params[pi].name}] に値 "${v}" はありません`);
    return v;
  }
  const out = [];
  while (p < toks.length) {
    if (peek().t === ';') { next(); continue; }
    if (peek().t === 'IF') {
      next(); const cond = expr(); expect('THEN'); const thenE = expr();
      let elseE = null; if (peek() && peek().t === 'ELSE') { next(); elseE = expr(); }
      out.push({ cond, thenE, elseE });
    } else {
      out.push({ cond: null, thenE: expr(), elseE: null });
    }
    if (peek() && peek().t === ';') next();
    else if (p < toks.length) fail('制約の終わりに ; が必要です');
  }
  return out;
}
const constraints = parseConstraints(constraintText);

// --- 3値論理で評価（未割り当ては undefined） ---
function ev(e, a) {
  switch (e.k) {
    case 'eq': return a[e.pi] === undefined ? undefined : params[e.pi].values[a[e.pi]] === e.v;
    case 'ne': return a[e.pi] === undefined ? undefined : params[e.pi].values[a[e.pi]] !== e.v;
    case 'in': return a[e.pi] === undefined ? undefined : e.set.has(params[e.pi].values[a[e.pi]]);
    case 'not': { const r = ev(e.e, a); return r === undefined ? undefined : !r; }
    case 'and': { const l = ev(e.l, a); if (l === false) return false; const r = ev(e.r, a); if (r === false) return false; return (l && r) ? true : undefined; }
    case 'or': { const l = ev(e.l, a); if (l === true) return true; const r = ev(e.r, a); if (r === true) return true; return (l === false && r === false) ? false : undefined; }
  }
}
const or3 = (x, y) => (x === true || y === true) ? true : (x === false && y === false) ? false : undefined;
const and3 = (x, y) => (x === false || y === false) ? false : (x === true && y === true) ? true : undefined;
const not3 = x => x === undefined ? undefined : !x;
function constraintOk(c, a) {
  const t = ev(c.thenE, a);
  if (!c.cond) return t;
  const cd = ev(c.cond, a);
  const el = c.elseE ? ev(c.elseE, a) : true;
  return and3(or3(not3(cd), t), or3(cd, el)); // (cond→then) ∧ (¬cond→else)
}
const violates = a => constraints.some(c => constraintOk(c, a) === false);

// ---------- 乱数（再現できるようにシード固定） ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(opt.seed);
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

// ---------- ペアの一覧 ----------
const N = params.length;
const key = (i, a, j, b) => i < j ? `${i}:${a}|${j}:${b}` : `${j}:${b}|${i}:${a}`;
const uncovered = new Set();
let invalidPairs = 0;
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++)
  for (let a = 0; a < params[i].values.length; a++) for (let b = 0; b < params[j].values.length; b++) {
    const asg = new Array(N); asg[i] = a; asg[j] = b;
    if (violates(asg)) invalidPairs++; else uncovered.add(key(i, a, j, b));
  }
const totalValidPairs = uncovered.size;

function coverRow(row) {
  let n = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (uncovered.delete(key(i, row[i], j, row[j]))) n++;
  return n;
}
function gain(asg, pi, v) {
  let n = 0;
  for (let j = 0; j < N; j++) if (j !== pi && asg[j] !== undefined && uncovered.has(key(pi, v, j, asg[j]))) n++;
  return n;
}
// 部分割り当てを、制約を守りながら貪欲に埋める（行き詰まったら null）
function fill(start) {
  const asg = start.slice();
  if (violates(asg)) return null;
  const order = shuffle([...Array(N).keys()].filter(i => asg[i] === undefined));
  for (const pi of order) {
    let best = -1, cands = [];
    for (let v = 0; v < params[pi].values.length; v++) {
      asg[pi] = v;
      if (violates(asg)) continue;
      const g = gain(asg, pi, v);
      if (g > best) { best = g; cands = [v]; } else if (g === best) cands.push(v);
    }
    if (cands.length === 0) return null;
    asg[pi] = cands[Math.floor(rand() * cands.length)];
  }
  return violates(asg) ? null : asg;
}
function rowGain(row) {
  let n = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (uncovered.has(key(i, row[i], j, row[j]))) n++;
  return n;
}

// ---------- 必須の組み合わせ（--include） ----------
const rows = [];
let includedCount = 0;
if (opt.include) {
  const inc = fs.readFileSync(opt.include, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  const head = inc[0].split('\t').map(s => s.trim());
  for (const h of head) if (!pIndex.has(h)) fail(`--include の列名がモデルにありません: ${h}`);
  for (const line of inc.slice(1)) {
    const cells = line.split('\t');
    const start = new Array(N);
    head.forEach((h, c) => {
      const v = (cells[c] || '').trim(); if (!v) return;
      const pi = pIndex.get(h); const vi = params[pi].values.indexOf(v);
      if (vi < 0) fail(`--include の値がモデルにありません: [${h}] ${v}`);
      start[pi] = vi;
    });
    let row = null;
    for (let t = 0; t < 50 && !row; t++) row = fill(start);
    if (!row) fail(`--include の行が制約に反しています: ${line}`);
    coverRow(row); rows.push(row); includedCount++;
  }
}

// ---------- 生成 ----------
const CANDIDATES = 40;
const failCount = new Map();
const unreachable = [];
while (uncovered.size > 0) {
  const list = [...uncovered];
  let best = null, bestGain = 0;
  for (let c = 0; c < CANDIDATES; c++) {
    const k = list[Math.floor(rand() * list.length)];
    const [[i, a], [j, b]] = k.split('|').map(s => s.split(':').map(Number));
    const start = new Array(N); start[i] = a; start[j] = b;
    const row = fill(start);
    if (!row) { failCount.set(k, (failCount.get(k) || 0) + 1); continue; }
    const g = rowGain(row);
    if (g > bestGain) { bestGain = g; best = row; }
  }
  if (best) { coverRow(best); rows.push(best); }
  // 3つ以上の条件が絡んで実現できないペアを除外
  for (const [k, n] of failCount) if (n >= 30 && uncovered.has(k)) { uncovered.delete(k); unreachable.push(k); }
  if (!best && uncovered.size > 0 && failCount.size === 0) fail('組み合わせを作れません（制約が厳しすぎる可能性）');
}

// ---------- 出力 ----------
const header = params.map(p => p.name);
const table = rows.map(r => r.map((v, i) => params[i].values[v]));
let out = '';
if (opt.format === 'csv') {
  const q = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  out = [header, ...table].map(r => r.map(q).join(',')).join('\n');
} else if (opt.format === 'md') {
  out = ['| No | ' + header.join(' | ') + ' |', '|---|' + header.map(() => '---').join('|') + '|',
    ...table.map((r, i) => `| ${i + 1} | ` + r.join(' | ') + ' |')].join('\n');
} else {
  out = [header, ...table].map(r => r.join('\t')).join('\n');
}
process.stdout.write(out + '\n');

// ---------- 検証 ----------
if (opt.verify) {
  // 独立に全ペアを再計算し、出力行で網羅されているか・制約違反がないか確かめる
  const covered = new Set();
  let violations = 0;
  for (const r of rows) {
    if (violates(r)) violations++;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) covered.add(key(i, r[i], j, r[j]));
  }
  let missing = 0; const unreachSet = new Set(unreachable);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++)
    for (let a = 0; a < params[i].values.length; a++) for (let b = 0; b < params[j].values.length; b++) {
      const asg = new Array(N); asg[i] = a; asg[j] = b;
      if (violates(asg)) continue;
      const k = key(i, a, j, b);
      if (!covered.has(k) && !unreachSet.has(k)) missing++;
    }
  const total = params.reduce((m, p) => m * p.values.length, 1);
  const fmtPair = k => k.split('|').map(s => { const [i, v] = s.split(':').map(Number); return `[${params[i].name}]=${params[i].values[v]}`; }).join(' × ');
  console.error([
    '--- 検証結果 ---',
    `パラメータ数: ${N}（${params.map(p => `${p.name}:${p.values.length}`).join(', ')}）`,
    `全組み合わせ: ${total} 通り → 生成: ${rows.length} 行（うち必須 ${includedCount} 行）`,
    `対象ペア: ${totalValidPairs}（制約で除外 ${invalidPairs}）`,
    `網羅できなかったペア: ${missing}`,
    `制約違反の行: ${violations}`,
    unreachable.length ? `実現不能として除外したペア: ${unreachable.length}\n  ` + unreachable.map(fmtPair).join('\n  ') : '実現不能として除外したペア: 0',
    missing === 0 && violations === 0 ? '判定: OK' : '判定: NG',
  ].join('\n'));
  if (missing || violations) process.exit(3);
}
