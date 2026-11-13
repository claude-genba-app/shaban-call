/* 車番コール 読み取りエンジン
 * 入力: pages = [{ width, height, lines: [{ y0, y1, conf, chars: [{ ch, x, brk }] }] }]
 *   chars は行内の文字(空白なし)。x は文字の中心のx座標。brk は「ここで語が切れる」印。
 * 出力: { title, date, sender, trucks: [...] }
 */
(function (root) {
  'use strict';

  var FIELDS = [
    ['slot', ['荷降順', '荷降', '号車', '車両No', '順番', 'NO.', 'No.', 'No', 'NO', '№']],
    ['time', ['到着時間', '時間', '時刻', '到着']],
    ['company', ['運送会社', '運送業者', '運送', '業者名']],
    ['kind', ['車種', '車格']],
    ['plate', ['車番', '車輌番号', '車両番号', 'ナンバー']],
    ['driver', ['乗務員', 'ドライバー', 'ドライバ', '運転手', '運転者', '氏名']],
    ['tel', ['携帯番号', '携帯電話', '電話番号', '携帯', '連絡先', 'TEL']],
    ['load', ['積載製品', '積載品', '積載', '積荷', '製品', '品名', '荷姿']],
    ['skip', ['積日', '積地', '卸日', '卸地', '着日', '備考', '工区']]
  ];

  var MAP = {};
  '０１２３４５６７８９'.split('').forEach(function (c, i) { MAP[c] = String(i); });
  'ー一－−—–‐ｰ~〜'.split('').forEach(function (c) { MAP[c] = '-'; });
  // 数字の並びの中でだけ使う読み替え
  var LOOK = { 'O': '0', 'o': '0', '〇': '0', '○': '0', 'D': '0', 'l': '1', 'I': '1', '|': '1', 'i': '1', '!': '1', 'S': '5', 'B': '8', 'Z': '2', 'z': '2' };

  function lineStr(l) { return l.chars.map(function (c) { return c.ch; }).join(''); }

  // 1文字ずつ対応する正規化文字列(長さを変えない)
  function normStr(chars) {
    var a = chars.map(function (c) { return MAP[c.ch] || c.ch; });
    for (var i = 0; i < a.length; i++) {
      if (LOOK[a[i]]) {
        var prev = a[i - 1] || '', next = a[i + 1] || '';
        if (/[\d-]/.test(prev) || /[\d-]/.test(next)) a[i] = LOOK[a[i]];
      }
    }
    return a.join('');
  }

  var PHONE_RE = /0[5789]0-?\d{4}-?\d{4}|0\d{1,4}-\d{1,4}-\d{3,4}/g;
  var OFFICE_RE = /TEL|FAX|ＴＥＬ|ＦＡＸ|Tel|Fax|〒|電話[:：]|代表/;

  var MOB_Y = /0[5789]0-?\d{4}-?\d{4}/y, GEN_Y = /0\d{1,4}-\d{1,4}-\d{3,4}/y;
  // 電話番号を探す。番号の直前に車番などの数字がくっついていても見つけられるように、
  // 「語の始まり・数字以外の後ろ」から始まる番号を先に、次に携帯番号の形だけを探す
  function findPhones(line) {
    var s = normStr(line.chars), out = [], used = [];
    function tryAt(i, res) {
      for (var r = 0; r < res.length; r++) {
        var re = res[r]; re.lastIndex = i; var m = re.exec(s);
        if (!m) continue;
        var digits = m[0].replace(/-/g, '');
        if (digits.length < 10 || digits.length > 11) continue;
        var end = i + m[0].length;
        // 後ろにも数字が続くときは番号の一部かもしれないので外す(090-1234-5678 のように区切りが揃っていれば採用)
        if (/\d/.test(s.charAt(end)) && !(line.chars[end] && line.chars[end].brk) && !/^0\d0-\d{4}-\d{4}$/.test(m[0])) continue;
        for (var k = i; k < end; k++) if (used[k]) return null;
        var raw = line.chars.slice(i, end).map(function (c) { return c.ch; }).join('');
        return { start: i, end: end, digits: digits, looked: /[^\d０-９\-ー一－−—–‐ｰ~〜]/.test(raw) };
      }
      return null;
    }
    function take(p) { if (!p) return; for (var k = p.start; k < p.end; k++) used[k] = true; out.push(p); }
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) !== '0' || used[i]) continue;
      var clean = i === 0 || line.chars[i].brk || !/\d/.test(s.charAt(i - 1));
      if (clean) take(tryAt(i, [MOB_Y, GEN_Y]));
    }
    for (i = 0; i < s.length; i++) {
      if (s.charAt(i) !== '0' || used[i]) continue;
      take(tryAt(i, [MOB_Y]));
    }
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  function fmtTel(d) {
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (/^0[36]/.test(d)) return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  }

  // 見出し行を探す(同じ見出しが2回以上あれば全部拾う＝表が横に並んでいる)
  function findHeader(line) {
    var s = lineStr(line), used = [], cols = [];
    var all = [];
    FIELDS.forEach(function (f) { f[1].forEach(function (kw) { all.push([f[0], kw]); }); });
    all.sort(function (a, b) { return b[1].length - a[1].length; });
    all.forEach(function (p) {
      var field = p[0], kw = p[1], from = 0, idx;
      while ((idx = s.indexOf(kw, from)) >= 0) {
        var ok = true;
        for (var k = idx; k < idx + kw.length; k++) if (used[k]) { ok = false; break; }
        if (ok) {
          for (k = idx; k < idx + kw.length; k++) used[k] = true;
          var xs = line.chars.slice(idx, idx + kw.length).map(function (c) { return c.x; });
          cols.push({ field: field, x: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 });
        }
        from = idx + kw.length;
      }
    });
    var main = cols.filter(function (c) { return c.field !== 'skip'; });
    var kinds = {}; main.forEach(function (c) { kinds[c.field] = 1; });
    var key = main.filter(function (c) { return c.field === 'tel' || c.field === 'driver' || c.field === 'plate'; });
    if (Object.keys(kinds).length >= 3 && key.length >= 1) return cols.sort(function (a, b) { return a.x - b.x; });
    return null;
  }

  // 行の見出し(「車番」「携帯」など)がどの項目かを当てる
  function labelField(text) {
    var s = String(text || '').replace(/\s/g, ''), best = null, bl = 0;
    FIELDS.forEach(function (f) { f[1].forEach(function (kw) { if (kw.length > bl && s.indexOf(kw) >= 0) { best = f[0]; bl = kw.length; } }); });
    return best;
  }

  // 表が横に2つ以上並んでいるときの境目(x)を、見出しの重なりから求める
  function tableBounds(header) {
    if (!header) return [];
    var occ = {};
    header.forEach(function (c) { if (c.field !== 'skip') (occ[c.field] = occ[c.field] || []).push(c.x); });
    var n = 0; Object.keys(occ).forEach(function (k) { n = Math.max(n, occ[k].length); });
    var bounds = [];
    for (var t = 1; t < n; t++) {
      var starts = []; Object.keys(occ).forEach(function (k) { if (occ[k][t] != null) starts.push(occ[k][t]); });
      var start = Math.min.apply(null, starts);
      var left = header.filter(function (c) { return c.x < start - 1; });
      var prev = left.length ? left[left.length - 1].x : start - 50;
      bounds.push((prev + start) / 2);
    }
    return bounds;
  }
  function segOf(bounds, x) { var i = 0; while (i < bounds.length && x >= bounds[i]) i++; return i; }

  // 行の文字を語に分ける
  function tokens(line, skipFrom, skipTo) {
    var h = Math.max(4, line.y1 - line.y0);
    var gap = h * 0.9;
    var out = [], cur = null;
    line.chars.forEach(function (c, i) {
      if (skipFrom != null && i >= skipFrom && i < skipTo) { cur = null; return; }
      if (!cur || c.brk || c.x - cur.lastX > gap) {
        cur = { text: '', xs: [], lastX: c.x };
        out.push(cur);
      }
      cur.text += c.ch; cur.xs.push(c.x); cur.lastX = c.x;
    });
    return out.map(function (t) {
      return { text: t.text, x: (t.xs[0] + t.xs[t.xs.length - 1]) / 2 };
    }).filter(function (t) { return t.text.replace(/[|｜_\-ー.,'"`]/g, '').length > 0; });
  }

  function tokensSkip(line, skip) {
    var h = Math.max(4, line.y1 - line.y0), gap = h * 0.9, out = [], cur = null;
    line.chars.forEach(function (c, i) {
      if (skip && skip[i]) { cur = null; return; }
      if (!cur || c.brk || c.x - cur.lastX > gap) { cur = { text: '', xs: [], lastX: c.x }; out.push(cur); }
      cur.text += c.ch; cur.xs.push(c.x); cur.lastX = c.x;
    });
    return out.map(function (t) { return { text: t.text, x: (t.xs[0] + t.xs[t.xs.length - 1]) / 2 }; })
      .filter(function (t) { return t.text.replace(/[|｜_\-ー.,'"`]/g, '').length > 0; });
  }

  function nearestCol(cols, x) {
    var best = null, bd = Infinity;
    cols.forEach(function (c) { var d = Math.abs(c.x - x); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  var JA = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef、。・]/;
  function joinTok(arr) {
    var out = '';
    arr.forEach(function (t) {
      if (!out) { out = t; return; }
      var a = out.charAt(out.length - 1), b = t.charAt(0);
      out += (JA.test(a) && JA.test(b)) ? t : ' ' + t;
    });
    return out;
  }
  function cleanJa(s) {
    if (Array.isArray(s)) s = joinTok(s);
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[Math.floor(b.length / 2)] : 0; }

  // 項目ごとに集めた語から、1台分を組み立てる
  function makeTruck(f, hasHeader, phone, line, band, conf, pi) {
    var slotTxt = joinTok(f.slot);
    var all = [slotTxt, f.time.join(' '), f.other.join(' ')].join(' ');
    var tm = normStr(all.split('').map(function (ch) { return { ch: ch }; })).match(/([0-2]?\d)[:：]([0-5]\d)/);
    var am = all.replace(/ＡＭ/g, 'AM').replace(/ＰＭ/g, 'PM').match(/(AM|PM)\s*([0-9０-９]+)/i);
    var slot = am ? am[1].toUpperCase() + normStr(am[2].split('').map(function (ch) { return { ch: ch }; })) : cleanJa(slotTxt.replace(/[0-2]?\d[:：][0-5]\d/, ''));
    if (!hasHeader && !am) slot = cleanJa(slotTxt);
    slot = slot.replace(/\s*(号車|台目)/, '$1');
    var t = {
      slot: slot,
      time: tm ? (+tm[1]) + ':' + tm[2] : '',
      company: cleanJa(f.company), kind: cleanJa(f.kind), plate: cleanJa(f.plate),
      driver: cleanJa(f.driver), load: cleanJa(f.load),
      info: hasHeader ? '' : cleanJa(joinTok(f.other).replace(/(AM|PM|ＡＭ|ＰＭ)\s*[0-9０-９]+/g, '').replace(/[0-2]?\d[:：][0-5]\d/, '')),
      tel: fmtTel(phone.digits),
      page: pi,
      band: band,
      telX: [line.chars[phone.start].x, line.chars[phone.end - 1].x],
      lineY: [line.y0, line.y1],
      uncertain: false, note: ''
    };
    var notes = [];
    if (conf < 75) notes.push('文字がかすれているか手書きで、読み取りの確かさが低めです');
    if (phone.looked) notes.push('番号の一部を文字から数字に読み替えています');
    if (phone.digits.length === 10 && /^0[5789]0/.test(phone.digits)) notes.push('携帯番号の桁が足りない可能性があります');
    if (notes.length) { t.uncertain = true; t.note = notes.join('。'); }
    return t;
  }
  function emptyF() { return { slot: [], time: [], company: [], kind: [], plate: [], driver: [], load: [], other: [] }; }

  // 1台ずつが「行」になっている表(1行に2台以上並ぶ場合も含む)
  function rowMode(lines, header, headerY, pi) {
    var out = [], bounds = tableBounds(header);
    var entries = [];
    lines.forEach(function (l) {
      if (l.isHeader || (l.y0 + l.y1) / 2 < headerY || OFFICE_RE.test(lineStr(l))) return;
      var ps = findPhones(l);
      if (!ps.length) return;
      // 見出しから境目が取れないときは、番号と番号の間で分ける
      var bs = bounds.length >= ps.length - 1 && bounds.length ? bounds : ps.slice(1).map(function (p, j) {
        var a = l.chars[ps[j].end - 1].x, b = l.chars[p.start].x, cw = Math.max(4, (l.y1 - l.y0) * 0.6); return Math.min(a + cw, (a + b) / 2);
      });
      ps.forEach(function (p, j) { entries.push({ line: l, phone: p, bounds: bs, seg: segOf(bs, l.chars[p.start].x), all: ps }); });
    });
    entries.forEach(function (en, k) {
      var l = en.line, h = Math.max(4, l.y1 - l.y0), cy = (l.y0 + l.y1) / 2;
      var same = entries.filter(function (o) { return o.seg === en.seg; });
      var idx = same.indexOf(en);
      var prevCy = idx > 0 ? (same[idx - 1].line.y0 + same[idx - 1].line.y1) / 2 : -Infinity;
      var nextCy = idx < same.length - 1 ? (same[idx + 1].line.y0 + same[idx + 1].line.y1) / 2 : Infinity;
      if (prevCy === cy) prevCy = -Infinity; if (nextCy === cy) nextCy = Infinity;
      var top = Math.max(cy - h * 1.8, (prevCy + cy) / 2, headerY);
      var bot = Math.min(cy + h * 1.8, (nextCy + cy) / 2);
      var band = lines.filter(function (o) { if (o.isHeader) return false; var oc = (o.y0 + o.y1) / 2; return oc >= top && oc <= bot; });
      var f = emptyF(), conf = l.conf == null ? 100 : l.conf;
      var cols = header ? header.filter(function (c) { return c.field !== 'tel' && segOf(en.bounds, c.x) === en.seg; }) : null;
      band.forEach(function (o) {
        var isMe = o === l;
        var ops = findPhones(o);
        if (!isMe && ops.some(function (p) { return segOf(en.bounds, o.chars[p.start].x) === en.seg; })) return;
        // この行の電話番号の文字はすべて除いて語に分ける
        var skip = [];
        ops.forEach(function (p) { for (var q = p.start; q < p.end; q++) skip[q] = true; });
        var tks = tokensSkip(o, skip);
        if (o.conf != null) conf = Math.min(conf, o.conf + (isMe ? 0 : 15));
        tks.forEach(function (t) {
          if (segOf(en.bounds, t.x) !== en.seg) return;
          if (cols && cols.length) {
            var c = nearestCol(cols, t.x);
            if (c.field === 'skip') return;
            (f[c.field] || f.other).push(t.text);
          } else f.other.push(t.text);
        });
      });
      out.push(makeTruck(f, !!(cols && cols.length), en.phone, l,
        { y0: Math.min.apply(null, band.map(function (o) { return o.y0; })), y1: Math.max.apply(null, band.map(function (o) { return o.y1; })) },
        conf, pi));
    });
    return out;
  }

  // 1台ずつが「列」になっている表(左に「車番」「携帯」などの見出しが縦に並ぶ)
  function columnMode(lines, multiLine, pi) {
    var ps = findPhones(multiLine);
    var cols = ps.map(function (p) { return (multiLine.chars[p.start].x + multiLine.chars[p.end - 1].x) / 2; });
    var colW = cols.length > 1 ? median(cols.slice(1).map(function (x, i) { return x - cols[i]; })) : 300;
    var labelLimit = cols[0] - colW * 0.55;
    var F = cols.map(function () { return emptyF(); }), phoneOf = cols.map(function () { return null; });
    var conf = 100, ys = [];
    lines.forEach(function (l) {
      if (OFFICE_RE.test(lineStr(l))) return;
      var lps = findPhones(l), skip = [];
      lps.forEach(function (p) {
        for (var q = p.start; q < p.end; q++) skip[q] = true;
        var x = (l.chars[p.start].x + l.chars[p.end - 1].x) / 2, best = -1, bd = Infinity;
        cols.forEach(function (cx, i) { var d = Math.abs(cx - x); if (d < bd) { bd = d; best = i; } });
        if (best >= 0 && bd < colW * 0.7 && !phoneOf[best]) phoneOf[best] = { line: l, phone: p };
      });
      var tks = tokensSkip(l, skip);
      var label = tks.filter(function (t) { return t.x < labelLimit; }).map(function (t) { return t.text; }).join('');
      var field = labelField(label);
      var used = false;
      tks.forEach(function (t) {
        if (t.x < labelLimit) return;
        var best = -1, bd = Infinity;
        cols.forEach(function (cx, i) { var d = Math.abs(cx - t.x); if (d < bd) { bd = d; best = i; } });
        if (best < 0 || bd > colW * 0.7) return;
        var fld = field;
        if (!fld && /^(No\.?|NO\.?|№)?\s*[0-9０-９]{1,2}\s*(号車|台目)?$/.test(t.text) && /号車|台目|No|NO|№/.test(t.text)) fld = 'slot';
        if (!fld || fld === 'skip' || fld === 'tel') return;
        F[best][fld].push(t.text); used = true;
      });
      if (used || lps.length) { ys.push(l.y0, l.y1); if (l.conf != null) conf = Math.min(conf, l.conf); }
    });
    var band = ys.length ? { y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) } : { y0: multiLine.y0, y1: multiLine.y1 };
    var out = [];
    cols.forEach(function (cx, i) {
      var pp = phoneOf[i]; if (!pp) return;
      var f = F[i];
      if (!f.slot.length) f.slot.push(String(i + 1));
      out.push(makeTruck(f, true, pp.phone, pp.line, band, pp.line.conf == null ? conf : Math.min(conf, pp.line.conf), pi));
    });
    return out;
  }

  function extract(pages) {
    var result = { title: '', date: '', sender: '', trucks: [] };
    var allText = [];

    pages.forEach(function (pg, pi) {
      var lines = pg.lines.filter(function (l) { return l.chars.length; })
        .sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); });
      var header = null, headerY = -Infinity;
      lines.forEach(function (l) {
        allText.push(lineStr(l));
        if (!header) { var hd = findHeader(l); if (hd) { header = hd; headerY = l.y1; l.isHeader = true; } }
      });
      var phoneLines = lines.filter(function (l) { return !l.isHeader && !OFFICE_RE.test(lineStr(l)) && findPhones(l).length; });
      var multi = phoneLines.filter(function (l) { return findPhones(l).length >= 2; })
        .sort(function (a, b) { return findPhones(b).length - findPhones(a).length; });
      var dupTel = header ? header.filter(function (c) { return c.field === 'tel'; }).length >= 2 : false;
      // 番号がほぼ1行に横並び → 1台が1列の表
      if (multi.length === 1 && !dupTel && phoneLines.length <= 2) {
        result.trucks = result.trucks.concat(columnMode(lines, multi[0], pi));
      } else {
        result.trucks = result.trucks.concat(rowMode(lines, header, headerY, pi));
      }
    });

    // 表全体の情報
    var joined = allText;
    for (var i = 0; i < joined.length; i++) {
      var s = normStr(joined[i].split('').map(function (ch) { return { ch: ch }; }));
      var dm = s.match(/(\d{1,2})月(\d{1,2})日/);
      if (dm && !result.date) result.date = (+dm[1]) + '月' + (+dm[2]) + '日';
      if (!result.title && /工事|工区|新築|改築|棟/.test(joined[i]) && !/会社/.test(joined[i])) {
        result.title = joined[i].replace(/\d{4}年|\d{1,2}月\d{1,2}日|搬入|御中|様/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
      }
      if (!result.sender) {
        var cm = joined[i].match(/(株式会社|有限会社|\(株\)|（株）|\(有\)|（有）)\s*[^\s,、。]{1,12}|[^\s,、。]{1,12}(株式会社|有限会社)/);
        if (cm) result.sender = cm[0].trim();
      }
    }
    return result;
  }

  var api = { extract: extract, findPhones: findPhones, normStr: normStr, fmtTel: fmtTel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShabanEngine = api;
})(this);
