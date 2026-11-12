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

  function findPhones(line) {
    var s = normStr(line.chars), out = [], m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(s))) {
      var digits = m[0].replace(/-/g, '');
      if (digits.length < 10 || digits.length > 11) continue;
      var raw = line.chars.slice(m.index, m.index + m[0].length).map(function (c) { return c.ch; }).join('');
      var looked = /[^\d０-９\-ー一－−—–‐ｰ~〜]/.test(raw); // 文字を数字に読み替えた
      out.push({ start: m.index, end: m.index + m[0].length, digits: digits, looked: looked });
    }
    return out;
  }

  function fmtTel(d) {
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (/^0[36]/.test(d)) return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  }

  // 見出し行を探す
  function findHeader(line) {
    var s = lineStr(line), used = [], cols = [];
    var all = [];
    FIELDS.forEach(function (f) { f[1].forEach(function (kw) { all.push([f[0], kw]); }); });
    all.sort(function (a, b) { return b[1].length - a[1].length; });
    var got = {};
    all.forEach(function (p) {
      var field = p[0], kw = p[1];
      if (got[field] && field !== 'skip') return;
      var from = 0, idx;
      while ((idx = s.indexOf(kw, from)) >= 0) {
        var ok = true;
        for (var k = idx; k < idx + kw.length; k++) if (used[k]) { ok = false; break; }
        if (ok) {
          for (k = idx; k < idx + kw.length; k++) used[k] = true;
          var xs = line.chars.slice(idx, idx + kw.length).map(function (c) { return c.x; });
          cols.push({ field: field, x: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 });
          got[field] = true;
          if (field !== 'skip') break;
        }
        from = idx + 1;
      }
    });
    var main = cols.filter(function (c) { return c.field !== 'skip'; });
    var key = main.filter(function (c) { return c.field === 'tel' || c.field === 'driver' || c.field === 'plate'; });
    if (main.length >= 3 && key.length >= 1) return cols.sort(function (a, b) { return a.x - b.x; });
    return null;
  }

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

      // 電話番号のある行
      var phoneLines = [];
      lines.forEach(function (l, li) {
        if (l.isHeader) return;
        if ((l.y0 + l.y1) / 2 < headerY) return;
        if (OFFICE_RE.test(lineStr(l))) return;
        var ps = findPhones(l);
        if (ps.length) phoneLines.push({ line: l, li: li, phone: ps[0] });
      });

      phoneLines.forEach(function (pl, k) {
        var l = pl.line, h = Math.max(4, l.y1 - l.y0), cy = (l.y0 + l.y1) / 2;
        var prevCy = k > 0 ? (phoneLines[k - 1].line.y0 + phoneLines[k - 1].line.y1) / 2 : -Infinity;
        var nextCy = k < phoneLines.length - 1 ? (phoneLines[k + 1].line.y0 + phoneLines[k + 1].line.y1) / 2 : Infinity;
        var top = Math.max(cy - h * 1.8, (prevCy + cy) / 2, headerY);
        var bot = Math.min(cy + h * 1.8, (nextCy + cy) / 2);
        var band = lines.filter(function (o) {
          if (o.isHeader) return false;
          var oc = (o.y0 + o.y1) / 2;
          return oc >= top && oc <= bot;
        });

        var f = { slot: [], time: [], company: [], kind: [], plate: [], driver: [], load: [], other: [] };
        var conf = l.conf == null ? 100 : l.conf;
        band.forEach(function (o) {
          var isMe = o === l;
          var tks = isMe ? tokens(o, pl.phone.start, pl.phone.end) : tokens(o);
          if (o !== l && findPhones(o).length) return;
          if (o.conf != null) conf = Math.min(conf, o.conf + (isMe ? 0 : 15));
          tks.forEach(function (t) {
            if (header) {
              var c = nearestCol(header.filter(function (h) { return h.field !== 'tel'; }), t.x);
              var fld = c.field;
              if (fld === 'skip') return;
              if (fld === 'tel') fld = 'other';
              (f[fld] || f.other).push(t.text);
            } else {
              f.other.push(t.text);
            }
          });
        });

        // 時刻・荷降順の切り出し
        var slotTxt = f.slot.join(' ');
        var all = [slotTxt, f.time.join(' '), f.other.join(' ')].join(' ');
        var tm = normStr(all.split('').map(function (ch) { return { ch: ch }; })).match(/([0-2]?\d)[:：]([0-5]\d)/);
        var am = all.replace(/ＡＭ/g, 'AM').replace(/ＰＭ/g, 'PM').match(/(AM|PM)\s*([0-9０-９]+)/i);
        var slot = am ? am[1].toUpperCase() + normStr(am[2].split('').map(function (ch) { return { ch: ch }; })) : cleanJa(slotTxt.replace(/[0-2]?\d[:：][0-5]\d/, ''));
        if (!header) slot = am ? slot : '';

        var t = {
          slot: slot,
          time: tm ? (+tm[1]) + ':' + tm[2] : '',
          company: cleanJa(f.company),
          kind: cleanJa(f.kind),
          plate: cleanJa(f.plate),
          driver: cleanJa(f.driver),
          load: cleanJa(f.load),
          info: header ? '' : cleanJa(joinTok(f.other).replace(/(AM|PM|ＡＭ|ＰＭ)\s*[0-9０-９]+/g, '').replace(/[0-2]?\d[:：][0-5]\d/, '')),
          tel: fmtTel(pl.phone.digits),
          page: pi,
          band: { y0: Math.min.apply(null, band.map(function (o) { return o.y0; })), y1: Math.max.apply(null, band.map(function (o) { return o.y1; })) },
          telX: [l.chars[pl.phone.start].x, l.chars[pl.phone.end - 1].x],
          lineY: [l.y0, l.y1],
          uncertain: false, note: ''
        };
        var notes = [];
        if (conf < 75) notes.push('文字がかすれているか手書きで、読み取りの確かさが低めです');
        if (pl.phone.looked) notes.push('番号の一部を文字から数字に読み替えています');
        if (pl.phone.digits.length === 10 && /^0[5789]0/.test(pl.phone.digits)) notes.push('携帯番号の桁が足りない可能性があります');
        if (notes.length) { t.uncertain = true; t.note = notes.join('。'); }
        result.trucks.push(t);
      });
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
