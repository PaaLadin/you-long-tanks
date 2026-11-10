'use strict';
// CutSceneLoader — грузит .cut файлы (SVG + metadata) из cutscenes/.
// Имя файла: PREFIX-N.cut, где PREFIX = '0'..'20' (уровень) или 'f0'..'f4' (финал).
// Сканирует по одному до первого 404. Кеш в памяти.
const CutSceneLoader = (function () {
  const cache = {};
  async function _fetchOne(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      const txt = await r.text();
      return txt;
    } catch (e) {
      return null;
    }
  }
  function _parse(text) {
    // Убираем HTML-комментарии, чтобы не поймать <metadata> из шапки
    const clean = text.replace(/<!--[\s\S]*?-->/g, '');
    const m = clean.match(/<metadata>([\s\S]*?)<\/metadata>/);
    let meta = null, body = text;
    if (m) {
      try { meta = JSON.parse(m[1]); } catch (e) { meta = null; }
      body = clean.slice(0, m.index) + clean.slice(m.index + m[0].length);
    }
    return { meta: meta, body: body };
  }
  async function loadSet(prefix) {
    if (cache['__set__' + prefix]) return cache['__set__' + prefix];
    const out = [];
    for (let i = 0; i < 100; i++) {
      const name = prefix + '-' + i + '.cut';
      const url = 'cutscenes/' + name;
      const txt = await _fetchOne(url);
      if (!txt) break;
      const parsed = _parse(txt);
      out.push({ name: name, meta: parsed.meta, body: parsed.body, url: url });
    }
    cache['__set__' + prefix] = out;
    return out;
  }
  function _svgFromBody(body) {
    // Обрезаем leading HTML-комментарий из шапки .cut
    const idx = body.indexOf('<svg');
    if (idx > 0) body = body.slice(idx);
    return body;
  }
  function _blobUrl(svgText) {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }
  async function prepare(prefix) {
    // Возвращает готовый массив для показа: {imgUrl, title, lines}
    const set = await loadSet(prefix);
    return set.map(function (item) {
      return {
        imgUrl: _blobUrl(_svgFromBody(item.body)),
        title: (item.meta && item.meta.title) || '',
        lines: (item.meta && item.meta.lines) || [],
        name: item.name
      };
    });
  }
  async function prepareForLevel(level) {
    // prefix = номер уровня без ведущих нулей (1,2,3,...,20)
    return prepare(String(level));
  }
  async function prepareForFinal(finalKey) {
    // finalKey: 'f0' (трибунал), 'f1' (победа), 'f2' (пасхалка), 'f3' (стена), 'f4' (game over)
    return prepare(finalKey);
  }
  return {
    prepare: prepare,
    prepareForLevel: prepareForLevel,
    prepareForFinal: prepareForFinal
  };
})();
