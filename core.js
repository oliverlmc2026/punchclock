/* 打卡記錄 — 核心計算邏輯（無 DOM，可喺 Node 測試） */
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // ---------- 文字（中 / 英） ----------
  const MSG = {
    zh: {
      alreadyIn: '已經上咗班', notIn: '未上班', alreadyBreak: '已經喺休息中', notBreak: '唔喺休息中',
      needStart: '請輸入上班時間', startFuture: '上班時間唔可以遲過而家', endFuture: '下班時間唔可以遲過而家',
      endAfterStart: '下班時間要遲過上班時間', max24: '一更唔可以超過 24 小時',
      brkFuture: '休息 {n} 唔可以遲過而家', brkBeforeStart: '休息 {n} 早過上班時間', brkAfterEnd: '休息 {n} 遲過下班時間',
      brkEndOrder: '休息 {n} 結束要遲過開始', brkEndAfterEnd: '休息 {n} 結束遲過下班時間',
      brkOverlap: '休息時段有重疊', brkOpen: '已下班嘅記錄，每段休息都要有結束時間',
      otherOpen: '已經有另一更未下班', overlap: '同 {d} 嘅另一更時間重疊',
      badFile: '檔案內容有錯', badFormat: '檔案格式唔啱',
      csvHead: ['日期', '上班', '下班', '跨日', '休息次數', '休息(分鐘)', '總時間(小時)', '淨工時(小時)', '淨工時(時:分)', '備註'],
      csvOpen: '(未下班)', csvYes: '是',
    },
    en: {
      alreadyIn: 'Already clocked in', notIn: 'Not clocked in', alreadyBreak: 'Already on a break', notBreak: 'Not on a break',
      needStart: 'Please enter the clock-in time', startFuture: 'Clock-in can’t be in the future', endFuture: 'Clock-out can’t be in the future',
      endAfterStart: 'Clock-out must be after clock-in', max24: 'A shift can’t be longer than 24 hours',
      brkFuture: 'Break {n} can’t be in the future', brkBeforeStart: 'Break {n} starts before clock-in', brkAfterEnd: 'Break {n} starts after clock-out',
      brkEndOrder: 'Break {n} must end after it starts', brkEndAfterEnd: 'Break {n} ends after clock-out',
      brkOverlap: 'Breaks overlap', brkOpen: 'Every break in a finished shift needs an end time',
      otherOpen: 'Another shift is still open', overlap: 'Overlaps another shift on {d}',
      badFile: 'The file contents are invalid', badFormat: 'Unrecognised file format',
      csvHead: ['Date', 'Start', 'End', 'Overnight', 'Breaks', 'Break (min)', 'Total (h)', 'Net (h)', 'Net (h:mm)', 'Note'],
      csvOpen: '(open)', csvYes: 'Yes',
    },
  };
  let lang = 'zh';
  function setLang(l) { lang = MSG[l] ? l : 'zh'; }
  // {x} 換做 v.x
  function msg(key, v) {
    const s = MSG[lang][key];
    return v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k]) : s;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 日期工具（全部用裝置本地時區） ----------
  function pad(n) { return String(n).padStart(2, '0'); }

  function dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // 一週由星期一開始
  function startOfWeek(ms) {
    const d = new Date(startOfDay(ms));
    const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }

  function addDays(ms, n) {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function startOfMonth(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }

  function addMonths(ms, n) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
  }

  // 編輯框只去到分鐘：如果框入面仲係原本嗰分鐘，就保留原本精確到秒嘅時間，唔好截走
  function keepPrecise(orig, parsed) {
    if (orig == null || parsed == null) return parsed;
    return new Date(orig).setSeconds(0, 0) === parsed ? orig : parsed;
  }

  // ---------- 狀態 ----------
  function openShift(shifts) {
    return shifts.find(s => s.end == null) || null;
  }

  function openBreak(shift) {
    if (!shift) return null;
    return shift.breaks.find(b => b.end == null) || null;
  }

  // 'off' | 'working' | 'break'
  function status(shifts) {
    const s = openShift(shifts);
    if (!s) return 'off';
    return openBreak(s) ? 'break' : 'working';
  }

  // ---------- 打卡動作（回傳新陣列，唔改原本） ----------
  function clone(shifts) { return JSON.parse(JSON.stringify(shifts)); }

  function clockIn(shifts, now, note) {
    if (openShift(shifts)) throw new Error(msg('alreadyIn'));
    const next = clone(shifts);
    next.push({ id: uid(), start: now, end: null, breaks: [], note: note || '' });
    return next;
  }

  function breakStart(shifts, now) {
    const next = clone(shifts);
    const s = openShift(next);
    if (!s) throw new Error(msg('notIn'));
    if (openBreak(s)) throw new Error(msg('alreadyBreak'));
    s.breaks.push({ start: now, end: null });
    return next;
  }

  function breakEnd(shifts, now) {
    const next = clone(shifts);
    const b = openBreak(openShift(next));
    if (!b) throw new Error(msg('notBreak'));
    b.end = Math.max(now, b.start);
    return next;
  }

  function clockOut(shifts, now, note) {
    const next = clone(shifts);
    const s = openShift(next);
    if (!s) throw new Error(msg('notIn'));
    const b = openBreak(s);
    if (b) b.end = Math.max(now, b.start); // 休息中直接下班 → 自動結束休息
    s.end = Math.max(now, s.start);
    if (note) s.note = s.note ? s.note + '；' + note : note;
    return next;
  }

  // 下班前檢查：'ok' 直接下班；'confirm' 超過 forgotHours，問一問係咪忘記咗打卡；
  // 'edit' 超過 24 小時，直接下班會存唔到（validateShift 唔俾），一定要改時間
  function clockOutCheck(shift, now, forgotHours) {
    const len = now - shift.start;
    if (len > DAY) return 'edit';
    if (len > forgotHours * HOUR) return 'confirm';
    return 'ok';
  }

  // ---------- 計算 ----------
  // 休息時間（只計落喺更內嘅部分），now 用於未完成嘅更/休息
  function breakMs(shift, now) {
    const sEnd = shift.end == null ? now : shift.end;
    let total = 0;
    for (const b of shift.breaks) {
      const bs = Math.max(b.start, shift.start);
      const be = Math.min(b.end == null ? now : b.end, sEnd);
      if (be > bs) total += be - bs;
    }
    return total;
  }

  function grossMs(shift, now) {
    const end = shift.end == null ? now : shift.end;
    return Math.max(0, end - shift.start);
  }

  function netMs(shift, now) {
    return Math.max(0, grossMs(shift, now) - breakMs(shift, now));
  }

  // 跨日班歸屬上班嗰日
  function shiftsInRange(shifts, fromMs, toMs) {
    return shifts.filter(s => s.start >= fromMs && s.start < toMs);
  }

  function sumNet(shifts, fromMs, toMs, now) {
    return shiftsInRange(shifts, fromMs, toMs).reduce((a, s) => a + netMs(s, now), 0);
  }

  function summarize(shifts, fromMs, toMs, now) {
    const list = shiftsInRange(shifts, fromMs, toMs);
    const days = new Set(list.map(s => dayKey(s.start)));
    return {
      count: list.length,
      days: days.size,
      net: list.reduce((a, s) => a + netMs(s, now), 0),
      brk: list.reduce((a, s) => a + breakMs(s, now), 0),
      gross: list.reduce((a, s) => a + grossMs(s, now), 0),
    };
  }

  // 每日淨工時（用於週圖）
  function dailyTotals(shifts, fromMs, nDays, now) {
    const out = [];
    for (let i = 0; i < nDays; i++) {
      const a = addDays(fromMs, i);
      const b = addDays(fromMs, i + 1);
      out.push({ day: a, net: sumNet(shifts, a, b, now) });
    }
    return out;
  }

  // ---------- 驗證（編輯/補打卡用） ----------
  // now（可選）：傳入就唔俾任何時間遲過而家
  function validateShift(shift, allShifts, now) {
    const errs = [];
    if (!(shift.start > 0)) errs.push(msg('needStart'));
    if (now != null) {
      if (shift.start > now) errs.push(msg('startFuture'));
      if (shift.end != null && shift.end > now) errs.push(msg('endFuture'));
    }
    if (shift.end != null && shift.end <= shift.start) errs.push(msg('endAfterStart'));
    if (shift.end != null && shift.end - shift.start > DAY) errs.push(msg('max24'));
    // 休息編號跟畫面次序（即係 breaks 陣列次序）
    let openCount = 0;
    shift.breaks.forEach((b, i) => {
      const n = { n: i + 1 };
      if (b.end == null) openCount++;
      if (now != null && (b.start > now || (b.end != null && b.end > now))) errs.push(msg('brkFuture', n));
      if (b.start < shift.start) errs.push(msg('brkBeforeStart', n));
      if (shift.end != null && b.start > shift.end) errs.push(msg('brkAfterEnd', n));
      if (b.end != null && b.end <= b.start) errs.push(msg('brkEndOrder', n));
      if (b.end != null && shift.end != null && b.end > shift.end) errs.push(msg('brkEndAfterEnd', n));
    });
    // 重疊檢查要按時間排序
    const sorted = shift.breaks.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (prev.end == null || prev.end > sorted[i].start) { errs.push(msg('brkOverlap')); break; }
    }
    if (openCount > 0 && shift.end != null) errs.push(msg('brkOpen'));
    if (shift.end == null) {
      const others = (allShifts || []).filter(s => s.id !== shift.id && s.end == null);
      if (others.length) errs.push(msg('otherOpen'));
    }
    // 同其他更重疊
    const sEnd = shift.end == null ? Infinity : shift.end;
    for (const o of allShifts || []) {
      if (o.id === shift.id) continue;
      const oEnd = o.end == null ? Infinity : o.end;
      if (shift.start < oEnd && o.start < sEnd) {
        errs.push(msg('overlap', { d: dayKey(o.start) }));
        break;
      }
    }
    return Array.from(new Set(errs));
  }

  // ---------- 格式 ----------
  function fmtDur(ms) {
    const totalMin = Math.floor(ms / MIN);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + ':' + pad(m);
  }

  function fmtClock(ms) {
    const d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function hoursDecimal(ms) {
    return (Math.round(ms / HOUR * 100) / 100).toFixed(2);
  }

  // ---------- CSV ----------
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(shifts, now) {
    const header = msg('csvHead');
    const rows = shifts.slice().sort((a, b) => a.start - b.start).map(s => {
      const crosses = s.end != null && dayKey(s.end) !== dayKey(s.start);
      return [
        dayKey(s.start),
        fmtClock(s.start),
        s.end == null ? msg('csvOpen') : fmtClock(s.end),
        crosses ? msg('csvYes') : '',
        s.breaks.length,
        Math.round(breakMs(s, now) / MIN),
        hoursDecimal(grossMs(s, now)),
        hoursDecimal(netMs(s, now)),
        fmtDur(netMs(s, now)),
        s.note || '',
      ];
    });
    // BOM 等 Excel 正確顯示中文
    return '﻿' + [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  // ---------- 備份 ----------
  function normalizeShift(s) {
    if (!s || typeof s.start !== 'number') throw new Error(msg('badFile'));
    return {
      id: s.id || uid(),
      start: s.start,
      end: typeof s.end === 'number' ? s.end : null,
      breaks: Array.isArray(s.breaks) ? s.breaks.filter(b => b && typeof b.start === 'number')
        .map(b => ({ start: b.start, end: typeof b.end === 'number' ? b.end : null })) : [],
      note: typeof s.note === 'string' ? s.note : '',
    };
  }

  // 還原備份用：有任何一更唔啱就成個檔案唔收
  function normalizeImport(data) {
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.shifts) ? data.shifts : null);
    if (!arr) throw new Error(msg('badFormat'));
    return arr.map(normalizeShift);
  }

  // 讀本機資料用：壞咗嘅更跳過，唔會因為一更壞咗就連其他記錄都唔要
  // ok=false 代表成份資料讀唔到；skipped = 略過咗幾多更
  function parseStored(raw) {
    const empty = { shifts: [], theme: 'auto', lang: null, lastBackup: null };
    if (raw == null || raw === '') return { ok: true, state: empty, skipped: 0 };
    let d;
    try { d = JSON.parse(raw); } catch (e) { return { ok: false, state: empty, skipped: 0 }; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, state: empty, skipped: 0 };
    if (d.shifts != null && !Array.isArray(d.shifts)) return { ok: false, state: empty, skipped: 0 };
    const shifts = [];
    let skipped = 0;
    for (const s of d.shifts || []) {
      try { shifts.push(normalizeShift(s)); } catch (e) { skipped++; }
    }
    return {
      ok: true,
      skipped,
      state: {
        shifts,
        theme: ['auto', 'light', 'dark'].includes(d.theme) ? d.theme : 'auto',
        lang: ['zh', 'en'].includes(d.lang) ? d.lang : null, // null = 跟瀏覽器
        lastBackup: typeof d.lastBackup === 'number' ? d.lastBackup : null,
      },
    };
  }

  const api = {
    MIN, HOUR, DAY, setLang, msg, uid, pad, keepPrecise, dayKey, startOfDay, startOfWeek, addDays, startOfMonth, addMonths,
    openShift, openBreak, status, clockIn, breakStart, breakEnd, clockOut, clockOutCheck,
    breakMs, grossMs, netMs, shiftsInRange, sumNet, summarize, dailyTotals,
    validateShift, fmtDur, fmtClock, hoursDecimal, toCSV, normalizeImport, parseStored,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
