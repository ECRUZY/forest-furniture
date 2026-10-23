/* ==========================================================================
   Forest Furniture — логика каталога
   Данные: window.SITE (data/config.js) и window.CATALOG.<раздел> (data/*.js)
   Адреса: #kitchens            — раздел
           #kitchens/12         — карточка модели № 12
           #kitchens/12/3       — фото № 3 модели № 12 на весь экран
           #filters, #contacts  — шторки
   ========================================================================== */
(function () {
  "use strict";

  var SITE = window.SITE;
  var CATALOG = window.CATALOG || {};

  /* ---------- Утилиты ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name, cls) { return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }
  function models(n) { return n + " " + plural(n, ["модель", "модели", "моделей"]); }
  function norm(s) { return String(s).toLowerCase().replace(/ё/g, "е"); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  var isHttp = /^https?:$/.test(location.protocol);

  /* ---------- Подготовка данных ---------- */
  // «395×275» → 395 (длинная сторона); «300» → 300
  function lengthOf(size) {
    var nums = String(size).split(/[×x*]/).map(function (s) { return parseFloat(s.replace(",", ".")); }).filter(function (n) { return n > 0; });
    return nums.length ? Math.max.apply(null, nums) : null;
  }

  // «В: 245, Г: 60, фасад МДФ» → высота, глубина и список особенностей
  function parseDesc(desc) {
    var out = { height: "", heightNote: "", depth: "", features: [] };
    if (!desc) return out;
    desc.split(/,\s*(?![^()]*\))/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = part.match(/^В:\s*([\d.,]+)\s*(.*)$/);
      if (m && !out.height) { out.height = m[1]; out.heightNote = m[2].replace(/^\(|\)$/g, ""); return; }
      m = part.match(/^Г:\s*([\d.,]+)/);
      if (m && !out.depth) { out.depth = m[1]; return; }
      out.features.push(cap(part));
    });
    return out;
  }

  function prepare(cat) {
    return (CATALOG[cat.id] || []).map(function (raw) {
      var p = Object.assign({}, raw);
      var d = parseDesc(p.desc);
      p.cat = cat;
      p.height = d.height; p.heightNote = d.heightNote; p.depth = d.depth; p.features = d.features;
      p.lens = p.sizes.map(lengthOf).filter(Boolean);
      p.types = p.type ? p.type.split(/\s+\/\s+/) : [];  // «4 двери / 6 дверей» — шкаф в двух вариантах
      p.full = []; p.thumbs = [];
      for (var i = 1; i <= p.photos; i++) {
        p.full.push("photos/" + cat.id + "/" + p.id + "_" + i + ".jpg");
        p.thumbs.push("photos/" + cat.id + "/thumbs/" + p.id + "_" + i + ".jpg");
      }
      p.hay = norm([p.name, p.producer, p.type, p.colors.join(" "), p.sizes.join(" "), p.desc].join(" "));
      return p;
    });
  }

  /* ---------- Состояние ---------- */
  var S = {
    cat: null, items: [], byId: {}, bounds: { min: 0, max: 0 },
    type: "all", q: "", lenMin: 0, lenMax: 0, producers: [], sort: "num",
    sel: {},          // выбранные размер/цвет/шкаф: { "kitchens:12": { size, color, type } }
    list: [],
    prepared: {},     // подготовленные модели разделов (чтобы корзина ссылалась на одни и те же объекты)
    cart: [],         // корзина — только в памяти: живёт до обновления страницы
  };

  function keyOf(p) { return p.cat.id + ":" + p.id; }
  function sel(p) {
    var k = keyOf(p);
    if (!S.sel[k]) S.sel[k] = { size: p.sizes[0] || "", color: p.colors[0] || "", type: p.types[p.types.length - 1] || "" };
    return S.sel[k];
  }

  function setCategory(id) {
    var cat = SITE.categories.filter(function (c) { return c.id === id; })[0] || SITE.categories[0];
    if (S.cat === cat) return;
    S.cat = cat;
    S.items = S.prepared[cat.id] || (S.prepared[cat.id] = prepare(cat));
    S.byId = {};
    S.items.forEach(function (p) { S.byId[p.id] = p; });
    var lens = [];
    S.items.forEach(function (p) { lens = lens.concat(p.lens); });
    S.bounds = lens.length ? { min: Math.min.apply(null, lens), max: Math.max.apply(null, lens) } : { min: 0, max: 0 };
    resetFilters(true);
    renderHero();
    renderFilterControls();
    render();
  }

  // Подписи раздела: у кухонь — «Размер» и «Тип», у спален — «Кровать» и «Шкаф»
  function opt(key, cat) {
    cat = cat || S.cat;
    var def = { typeName: "Тип", typeTag: "{type} " + cat.one, sizeName: "Размер", sizeLabel: "Размер, см", sizeWord: "размер" };
    return cat[key] != null ? cat[key] : def[key];
  }
  function typeTag(p) { return p.type ? opt("typeTag", p.cat).replace("{type}", p.type) : cap(p.cat.one); }
  function hasLenFilter() { return S.cat.lengthFilter !== false && S.bounds.max > S.bounds.min; }

  function lenActive() { return hasLenFilter() && (S.lenMin > S.bounds.min || S.lenMax < S.bounds.max); }

  function resetFilters(silent) {
    S.type = "all"; S.q = ""; S.producers = [];
    S.lenMin = S.bounds.min; S.lenMax = S.bounds.max;
    $("#q").value = "";
    if (!silent) { syncFilterControls(); render(); }
  }

  /* ---------- Отбор и сортировка ---------- */
  function passesFilters(p, ignoreType) {
    if (!ignoreType && S.type !== "all" && p.types.indexOf(S.type) < 0) return false;
    if (S.producers.length && S.producers.indexOf(p.producer) < 0) return false;
    if (lenActive() && !p.lens.some(function (l) { return l >= S.lenMin && l <= S.lenMax; })) return false;
    return true;
  }

  function filtered(ignoreType) {
    var q = norm(S.q).replace(/[№#]/g, " ").trim();
    var list = S.items.filter(function (p) { return passesFilters(p, ignoreType); });
    if (!q) return list;
    // Только число — ищем по номеру модели; если такого номера нет — по размерам/тексту
    if (/^\d+$/.test(q)) {
      var exact = list.filter(function (p) { return String(p.id) === q; });
      if (exact.length) return exact;
    }
    var words = q.split(/\s+/);
    return list.filter(function (p) {
      return words.every(function (w) { return p.hay.indexOf(w) >= 0 || String(p.id) === w; });
    });
  }

  function sorted(list) {
    var by = {
      "num": function (a, b) { return a.id - b.id; },
      "len-asc": function (a, b) { return (Math.min.apply(null, a.lens) - Math.min.apply(null, b.lens)) || a.id - b.id; },
      "len-desc": function (a, b) { return (Math.max.apply(null, b.lens) - Math.max.apply(null, a.lens)) || a.id - b.id; },
      "name": function (a, b) { return a.name.localeCompare(b.name, "ru") || a.id - b.id; },
    }[S.sort];
    return list.slice().sort(by);
  }

  /* ---------- Заявка в мессенджер ---------- */
  // Ссылка на страницу-превью модели (kitchens/12/). У неё свои og:-теги, поэтому
  // WhatsApp и Telegram показывают её карточкой: фото, название, размер.
  // Страницы создаются из админки (admin.html → «Обновить превью»).
  var SITE_BASE = (SITE.siteUrl || location.origin + location.pathname.replace(/[^/]*$/, "")).replace(/\/?$/, "/");
  function shareUrl(p) { return SITE_BASE + p.cat.id + "/" + p.id + "/"; }

  // Короткая заявка: карточку модели мессенджер соберёт из ссылки сам
  // «кухня № 12 «Марьям», размер 470×210 см, цвет белый матовый»
  function itemText(p) {
    var s = sel(p);
    var details = [
      p.types.length > 1 && opt("typeTag", p.cat).replace("{type}", s.type).toLowerCase(),
      s.size && opt("sizeWord", p.cat) + " " + s.size + " см",
      s.color && "цвет " + s.color.toLowerCase(),
    ].filter(Boolean);
    return p.cat.one + " № " + p.id + " «" + p.name + "»" + (details.length ? ", " + details.join(", ") : "");
  }
  function message(p) {
    var lines = ["Здравствуйте! Интересует " + itemText(p) + "."];
    if (isHttp) lines.push(shareUrl(p));
    return lines.join("\n");
  }
  // Вся корзина одним сообщением — чтобы не писать менеджеру про каждую модель отдельно
  function cartMessage() {
    if (S.cart.length === 1) return message(S.cart[0]);
    var lines = ["Здравствуйте! Интересуют модели из каталога " + SITE.brand + ":"];
    S.cart.forEach(function (p, i) {
      lines.push("", (i + 1) + ". " + cap(itemText(p)) + ".");
      if (isHttp) lines.push(shareUrl(p));
    });
    lines.push("", "Подскажите, пожалуйста, цену и наличие.");
    return lines.join("\n");
  }
  function waHref(text) { return "https://wa.me/" + SITE.whatsapp + (text ? "?text=" + encodeURIComponent(text) : ""); }
  // t.me/<username>?text= — Telegram подставит текст в поле ввода чата с менеджером
  function tgHref(text) { return "https://t.me/" + SITE.telegram + (text ? "?text=" + encodeURIComponent(text) : ""); }
  var TG_HREF = tgHref("");

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      ta.remove();
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $("#toast");
    t.textContent = text;
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-shown"); }, 3200);
  }

  /* ---------- Шаблоны ---------- */
  function slidesHtml(p, srcs, opts) {
    return srcs.map(function (src, i) {
      var eager = opts.eager && i === 0;
      return '<a class="car-slide" href="#' + p.cat.id + "/" + p.id + (opts.zoom ? "/" + (i + 1) : "") + '" data-open="' + p.id + '" data-i="' + i + '"' +
        ' aria-label="Фото ' + (i + 1) + " из " + srcs.length + '">' +
        '<img src="' + src + '" alt="' + esc(p.cat.one + " «" + p.name + "», фото " + (i + 1)) + '"' +
        (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"></a>';
    }).join("");
  }

  function carouselHtml(p, srcs, opts) {
    var n = srcs.length;
    var h = '<div class="car' + (opts.contain ? " car--contain" : "") + '" data-car>' +
      '<div class="car-track">' + slidesHtml(p, srcs, opts) + "</div>";
    if (opts.badges) {
      h += '<div class="car-badges"><span class="tag tag--num">№ ' + p.id + "</span>" + (p.type ? '<span class="tag">' + esc(p.types.join(" / ").replace(/ (двери|дверей) \/ /g, " / ")) + "</span>" : "") + "</div>";
    }
    if (n > 1) {
      h += '<button class="car-arrow car-arrow--prev" type="button" data-step="-1" aria-label="Предыдущее фото">' + icon("left") + "</button>" +
        '<button class="car-arrow car-arrow--next" type="button" data-step="1" aria-label="Следующее фото">' + icon("right") + "</button>" +
        '<div class="car-foot"><div class="dots">' + srcs.map(function (_, i) { return '<i class="' + (i ? "" : "is-on") + '"></i>'; }).join("") + "</div></div>";
    }
    return h + "</div>";
  }

  function optionsHtml(p, kind) {
    var s = sel(p);
    var values = { size: p.sizes, color: p.colors, type: p.types }[kind];
    if (!values.length) return "";
    var label = { size: opt("sizeLabel"), color: "Цвет", type: opt("typeName") }[kind];
    var cur = s[kind];
    var single = values.length === 1;
    return '<div><p class="opt-label">' + label + '</p><div class="opts">' + values.map(function (v) {
      if (single) return '<span class="opt opt--static is-on">' + esc(v) + "</span>";
      return '<button class="opt' + (v === cur ? " is-on" : "") + '" type="button" data-pick="' + kind + '" data-id="' + p.id + '" data-value="' + esc(v) + '" aria-pressed="' + (v === cur) + '">' + esc(v) + "</button>";
    }).join("") + "</div></div>";
  }

  function cartBtnHtml(p, square) {
    var on = S.cart.indexOf(p) >= 0;
    return '<button class="btn btn--cart' + (square ? " btn--square" : "") + (on ? " is-on" : "") + '" type="button" data-cart="' + keyOf(p) + '" aria-pressed="' + on + '"' +
      (square ? ' aria-label="' + (on ? "Убрать из корзины" : "Положить в корзину") + '"' : "") + ">" +
      icon(on ? "check" : "bag") + (square ? "" : "<span>" + (on ? "В корзине" : "В корзину") + "</span>") + "</button>";
  }

  function ctaHtml(p, wide) {
    return '<a class="btn btn--wa" href="' + esc(waHref(message(p))) + '" target="_blank" rel="noopener" data-wa-item="' + p.id + '">' + icon("wa") + "<span>Узнать цену" + (wide ? '<span class="cta-more"> в WhatsApp</span>' : "") + "</span></a>" +
      (wide ? cartBtnHtml(p, true) : "") +
      '<a class="btn btn--tg btn--square" href="' + esc(tgHref(message(p))) + '" target="_blank" rel="noopener" data-tg-item="' + p.id + '" aria-label="Написать в Telegram">' + icon("tg") + "</a>" +
      '<a class="btn btn--line btn--square" href="' + SITE.phoneHref + '" aria-label="Позвонить">' + icon("phone") + "</a>";
  }

  function subline(p) {
    var parts = [p.producer];
    if (p.height) parts.push("высота " + p.height + " см");
    return parts.filter(Boolean).map(esc).join(" · ");
  }

  function cardHtml(p, i) {
    return '<article class="card" data-id="' + p.id + '" style="animation-delay:' + Math.min(i, 8) * 40 + 'ms">' +
      carouselHtml(p, p.thumbs, { badges: true, eager: i < 2 }) +
      '<div class="card-body">' +
        '<div class="card-head"><div class="card-head-link">' +
          '<h2 class="card-title"><a href="#' + p.cat.id + "/" + p.id + '" data-open="' + p.id + '">' + esc(p.name) + "</a></h2>" +
          '<p class="card-sub">' + subline(p) + "</p>" +
        "</div></div>" +
        (p.types.length > 1 ? optionsHtml(p, "type") : "") + optionsHtml(p, "size") + optionsHtml(p, "color") +
        '<div class="card-cta">' + ctaHtml(p, false) + cartBtnHtml(p, false) + "</div>" +
      "</div></article>";
  }

  /* ---------- Рендер ---------- */
  function renderHero() {
    var cat = S.cat;
    document.title = cat.title + " — " + SITE.brand;
    $("#heroTitle").textContent = cat.title;
    $("#heroLead").textContent = cat.lead;
    $("#catTabs").innerHTML = SITE.categories.map(function (c) {
      var n = (CATALOG[c.id] || []).length;
      return '<a class="cat-tab' + (c === cat ? " is-active" : "") + '" href="#' + c.id + '"' + (c === cat ? ' aria-current="page"' : "") + ">" + esc(c.title) + "<sup>" + n + "</sup></a>";
    }).join("");
    var count = function (t) { return S.items.filter(function (p) { return p.types.indexOf(t) >= 0; }).length; };
    var label = function (t) { return (cat.typeLabels || {})[t] || t; };
    var top = cat.types.slice().sort(function (a, b) { return count(b) - count(a); }).slice(0, 2);
    var stats = [["Моделей", S.items.length, ""]].concat(top.map(function (t) { return [label(t), count(t), ""]; }));
    if (stats.length < 3) stats.push(["Длина", S.bounds.min + "–" + S.bounds.max, "см"]);
    $("#heroStats").innerHTML = stats.map(function (s) {
      return '<div class="hero-stat"><dt>' + esc(s[0]) + "</dt><dd>" + esc(s[1]) + (s[2] ? " <small>" + s[2] + "</small>" : "") + "</dd></div>";
    }).join("");
  }

  function typeChipsHtml() {
    var base = filtered(true);
    var chips = [["all", "Все", base.length]];
    S.cat.types.forEach(function (t) {
      chips.push([t, (S.cat.typeLabels || {})[t] || t, base.filter(function (p) { return p.types.indexOf(t) >= 0; }).length]);
    });
    return chips.map(function (c) {
      return '<button class="chip' + (S.type === c[0] ? " is-on" : "") + '" type="button" data-type="' + esc(c[0]) + '" aria-pressed="' + (S.type === c[0]) + '">' + esc(c[1]) + "<sup>" + c[2] + "</sup></button>";
    }).join("");
  }

  function render() {
    S.list = sorted(filtered(false));
    var grid = $("#grid");
    grid.innerHTML = S.list.map(cardHtml).join("");
    $("#empty").hidden = S.list.length > 0;

    var total = S.items.length, n = S.list.length;
    $("#resultCount").innerHTML = n === total
      ? "Все " + esc(S.cat.title.toLowerCase()) + ": <b>" + models(n) + "</b>"
      : "<b>" + models(n) + "</b> из " + total;

    $("#typeSeg").innerHTML = typeChipsHtml();
    $("#fType").innerHTML = typeChipsHtml();
    renderActiveFilters();
    $("#fApply").textContent = n ? "Показать " + models(n) : "Ничего не найдено";
    $("#qClear").hidden = !S.q;
  }

  function renderActiveFilters() {
    var chips = [];
    if (lenActive()) chips.push(['data-clear="len"', S.lenMin + "–" + S.lenMax + " см"]);
    S.producers.forEach(function (pr) { chips.push(['data-clear="producer" data-value="' + esc(pr) + '"', esc(pr)]); });
    var box = $("#activeFilters");
    box.hidden = !chips.length;
    if (chips.length > 1) chips.push(['data-reset', "Сбросить всё"]);
    box.innerHTML = chips.map(function (c) {
      return '<button class="chip chip--x" type="button" ' + c[0] + ">" + c[1] + (c[0] === "data-reset" ? "" : icon("x")) + "</button>";
    }).join("");
    var count = (lenActive() ? 1 : 0) + S.producers.length;
    var badge = $("#filterCount");
    badge.hidden = !count;
    badge.textContent = count;
  }

  /* ---------- Фильтры (шторка) ---------- */
  function renderFilterControls() {
    var b = S.bounds;
    $("#fLenGroup").hidden = !hasLenFilter();
    $("#fTypeTitle").textContent = opt("typeName");
    ["#fLenMin", "#fLenMax", "#fLenMinNum", "#fLenMaxNum"].forEach(function (id) {
      var el = $(id); el.min = b.min; el.max = b.max; el.step = 1;
    });
    var counts = {};
    S.items.forEach(function (p) { if (p.producer) counts[p.producer] = (counts[p.producer] || 0) + 1; });
    var producers = Object.keys(counts).sort(function (a, c) { return counts[c] - counts[a] || a.localeCompare(c, "ru"); });
    $("#fProducers").innerHTML = producers.map(function (pr) {
      return '<button class="chip" type="button" data-producer="' + esc(pr) + '" aria-pressed="false">' + esc(pr) + "<sup>" + counts[pr] + "</sup></button>";
    }).join("");
    syncFilterControls();
  }

  function syncFilterControls() {
    var b = S.bounds;
    $("#fLenMin").value = S.lenMin; $("#fLenMax").value = S.lenMax;
    if (document.activeElement !== $("#fLenMinNum")) $("#fLenMinNum").value = S.lenMin;
    if (document.activeElement !== $("#fLenMaxNum")) $("#fLenMaxNum").value = S.lenMax;
    var span = (b.max - b.min) || 1;
    var a = (S.lenMin - b.min) / span * 100, z = (S.lenMax - b.min) / span * 100;
    $("#fLenFill").style.left = a + "%";
    $("#fLenFill").style.width = (z - a) + "%";
    $("#fLenVal").textContent = S.lenMin + " – " + S.lenMax + " см";
    // Если ползунки сошлись у правого края — «от» должен оказаться сверху, иначе его не сдвинуть
    $("#fLenMin").style.zIndex = S.lenMin > (b.min + b.max) / 2 ? 3 : 1;
    $("#fLenMax").style.zIndex = 2;
    $$("#fProducers .chip").forEach(function (c) {
      var on = S.producers.indexOf(c.dataset.producer) >= 0;
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", on);
    });
  }

  function setLen(min, max, from) {
    var b = S.bounds;
    min = Math.max(b.min, Math.min(b.max, isNaN(min) ? b.min : min));
    max = Math.max(b.min, Math.min(b.max, isNaN(max) ? b.max : max));
    if (min > max) { if (from === "min") max = min; else min = max; }
    S.lenMin = min; S.lenMax = max;
    syncFilterControls();
    renderSoon();
  }
  var renderSoon = debounce(render, 60);

  function bindFilters() {
    $("#fLenMin").addEventListener("input", function () { setLen(+this.value, S.lenMax, "min"); });
    $("#fLenMax").addEventListener("input", function () { setLen(S.lenMin, +this.value, "max"); });
    $("#fLenMinNum").addEventListener("change", function () { setLen(parseInt(this.value, 10), S.lenMax, "min"); this.value = S.lenMin; });
    $("#fLenMaxNum").addEventListener("change", function () { setLen(S.lenMin, parseInt(this.value, 10), "max"); this.value = S.lenMax; });
  }

  /* ---------- Карусели ---------- */
  function carIndex(track) { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); }

  function carGo(track, i, smooth) {
    var n = track.children.length;
    i = (i + n) % n;
    track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }

  function onTrackScroll(track) {
    var car = track.closest("[data-car]");
    var i = carIndex(track);
    if (car) $$(".dots i", car).forEach(function (d, k) { d.classList.toggle("is-on", k === i); });
    if (car && car.closest("#detail")) {
      // Прокручиваем только ленту миниатюр (scrollIntoView сдвигал бы всю шторку)
      $$("#detail .thumb").forEach(function (t, k) {
        t.classList.toggle("is-on", k === i);
        if (k === i) t.parentNode.scrollTo({ left: t.offsetLeft - (t.parentNode.clientWidth - t.offsetWidth) / 2, behavior: "smooth" });
      });
    }
    if (track.id === "lbTrack") $("#lbCount").textContent = (i + 1) + " / " + track.children.length;
  }

  document.addEventListener("scroll", function (e) {
    var t = e.target;
    if (!t.classList || !(t.classList.contains("car-track") || t.id === "lbTrack")) return;
    if (t._raf) return;
    t._raf = requestAnimationFrame(function () { t._raf = 0; onTrackScroll(t); });
  }, { capture: true, passive: true });

  // Широкие фото заполняют кадр карточки, вертикальные — показываются целиком
  document.addEventListener("load", function (e) {
    var img = e.target;
    if (img.tagName !== "IMG" || !img.closest(".car-slide")) return;
    var r = img.naturalWidth / img.naturalHeight;
    if (r > 1.2 && r < 1.9) img.classList.add("is-wide");
    img.classList.add("is-loaded");
  }, true);
  document.addEventListener("error", function (e) {
    if (e.target.tagName === "IMG") e.target.classList.add("is-loaded");
  }, true);

  /* ---------- Слои: открытие/закрытие ---------- */
  var layerTimers = {};
  var lastFocus = null;

  function showLayer(el) {
    clearTimeout(layerTimers[el.id]);
    if (!el.hidden && el.classList.contains("is-open")) return;
    if (!document.querySelector(".layer.is-open, .lightbox.is-open")) lastFocus = document.activeElement;
    el.hidden = false;
    el.offsetHeight; // reflow, чтобы сработала анимация
    el.classList.add("is-open");
    syncLock();
    var focusEl = $("[data-close].icon-btn, [data-close].glass-btn, .glass-btn", el);
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function hideLayer(el) {
    if (el.hidden) return;
    el.classList.remove("is-open");
    layerTimers[el.id] = setTimeout(function () {
      el.hidden = true;
      if (el.id === "detailLayer") $("#detail").innerHTML = "";
    }, 380);
    syncLock();
    if (!document.querySelector(".layer.is-open, .lightbox.is-open") && lastFocus && lastFocus.focus) {
      lastFocus.focus({ preventScroll: true });
    }
  }

  function syncLock() {
    document.documentElement.classList.toggle("is-locked", !!document.querySelector(".layer.is-open, .lightbox.is-open"));
  }

  // Свайп вниз закрывает шторку (только на телефоне)
  function dragToClose(sheet) {
    var y0, x0, dy, mode, scroller;
    sheet.addEventListener("touchstart", function (e) {
      if (innerWidth >= 600 || e.touches.length > 1 || e.target.closest("input, .range")) { mode = "off"; return; }
      scroller = $(".sheet-scroll", sheet);
      var inScroll = scroller && scroller.contains(e.target);
      if (inScroll && scroller.scrollTop > 0) { mode = "off"; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; mode = "wait";
    }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (mode === "off" || mode == null) return;
      var ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
      if (mode === "wait") {
        if (Math.abs(ddy) < 8 && Math.abs(ddx) < 8) return;
        mode = ddy > 0 && Math.abs(ddy) > Math.abs(ddx) ? "drag" : "off";
        if (mode === "drag") sheet.classList.add("is-dragging");
      }
      if (mode === "drag") {
        e.preventDefault();
        dy = Math.max(0, ddy);
        sheet.style.transform = "translateY(" + dy + "px)";
      }
    }, { passive: false });
    function end() {
      if (mode === "drag") {
        sheet.classList.remove("is-dragging");
        sheet.style.transform = "";
        if (dy > 110) closeTop();
      }
      mode = null;
    }
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  }

  /* ---------- Карточка модели ---------- */
  var detailId = null;

  function renderDetail(p, startIndex) {
    var specs = [];
    specs.push([opt("sizeName"), p.sizes.length > 1 ? p.sizes.length + " " + plural(p.sizes.length, ["вариант", "варианта", "вариантов"]) : (p.sizes[0] || "—"), p.sizes.length > 1 ? "" : "см"]);
    if (p.height) specs.push(["Высота", p.height, "см" + (p.heightNote ? " · " + p.heightNote : "")]);
    if (p.depth) specs.push(["Глубина", p.depth, "см"]);
    if (p.type) specs.push([opt("typeName"), p.types.length > 1 ? p.types.length + " " + plural(p.types.length, ["вариант", "варианта", "вариантов"]) : p.type, ""]);
    if (p.colors.length === 1) specs.push(["Цвет", p.colors[0], ""]);
    specs.push(["Фото", p.photos, ""]);
    if (specs.length % 2) specs.pop();

    var thumbs = p.photos > 1
      ? '<div class="thumbs">' + p.thumbs.map(function (src, i) {
        return '<button class="thumb' + (i === startIndex ? " is-on" : "") + '" type="button" data-thumb="' + i + '" aria-label="Фото ' + (i + 1) + '"><img src="' + src + '" alt="" loading="lazy"></button>';
      }).join("") + "</div>"
      : "";

    var features = p.features.length
      ? '<div><p class="section-title">Комплектация и особенности</p><ul class="features">' +
        p.features.map(function (f) { return "<li>" + icon("check") + "<span>" + esc(f) + "</span></li>"; }).join("") + "</ul></div>"
      : "";

    $("#detail").innerHTML =
      '<div class="sheet-grip"><i></i></div>' +
      '<div class="sheet-head">' +
        '<button class="glass-btn detail-head-left" type="button" data-close aria-label="Закрыть">' + icon("down") + "</button>" +
        '<div class="detail-head-right">' +
          '<button class="glass-btn" type="button" data-share="' + p.id + '" aria-label="Поделиться">' + icon("share") + "</button>" +
          '<button class="glass-btn" type="button" data-zoom aria-label="Открыть фото на весь экран">' + icon("expand") + "</button>" +
          '<button class="glass-btn detail-close-desktop" type="button" data-close aria-label="Закрыть">' + icon("x") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="sheet-scroll">' +
        '<div class="detail-media"><div class="detail-gallery">' + carouselHtml(p, p.full, { contain: true, zoom: true, eager: true }) + "</div>" + thumbs + "</div>" +
        '<div class="detail-side">' +
          '<div class="detail-info">' +
            "<div>" +
              '<div class="detail-eyebrow"><span class="tag tag--num">№ ' + p.id + '</span><span class="tag">' + esc(typeTag(p)) + "</span></div>" +
              '<h2 class="detail-title" id="dTitle">' + esc(p.name) + "</h2>" +
              (p.producer ? '<p class="detail-producer">' + esc(p.producer) + "</p>" : "") +
            "</div>" +
            '<dl class="specs">' + specs.map(function (s) {
              return '<div class="spec"><dt>' + s[0] + "</dt><dd>" + esc(s[1]) + (s[2] ? " <small>" + esc(s[2]) + "</small>" : "") + "</dd></div>";
            }).join("") + "</dl>" +
            (p.types.length > 1 ? optionsHtml(p, "type") : "") +
            (p.sizes.length > 1 ? optionsHtml(p, "size") : "") +
            (p.colors.length > 1 ? optionsHtml(p, "color") : "") +
            features +
            '<p class="detail-note">' + icon("info") + "<span>Цена зависит от размера, цвета и комплектации. Напишите нам — рассчитаем стоимость и подскажем сроки доставки.</span></p>" +
          "</div>" +
          '<div class="sheet-foot">' + ctaHtml(p, true) + "</div>" +
        "</div>" +
      "</div>";
  }

  function openDetailUI(id, startIndex) {
    var p = S.byId[id];
    if (!p) return false;
    var layer = $("#detailLayer");
    startIndex = Math.max(0, Math.min(p.photos - 1, startIndex || 0));
    if (detailId !== id || layer.hidden) {
      detailId = id;
      renderDetail(p, startIndex);
      showLayer(layer);
      $("#detail .sheet-scroll").scrollTop = 0;
      if (startIndex) requestAnimationFrame(function () { carGo($("#detail .car-track"), startIndex, false); });
    }
    return true;
  }

  function closeDetailUI() { detailId = null; hideLayer($("#detailLayer")); }

  /* ---------- Фото на весь экран ---------- */
  var lbId = null;
  function openLightboxUI(id, index) {
    var p = S.byId[id];
    if (!p) return;
    var lb = $("#lightbox"), track = $("#lbTrack");
    if (lbId !== id) {
      lbId = id;
      track.innerHTML = p.full.map(function (src, i) {
        return '<div class="lb-slide"><img src="' + src + '" alt="' + esc(p.name + ", фото " + (i + 1)) + '" decoding="async"></div>';
      }).join("");
      $("#lbTitle").textContent = "№ " + p.id + " · " + p.name;
    }
    $$(".lb-arrow", lb).forEach(function (b) { b.hidden = p.photos < 2; });
    showLayer(lb);
    requestAnimationFrame(function () { carGo(track, index, false); onTrackScroll(track); });
  }
  function closeLightboxUI() {
    var lb = $("#lightbox");
    if (lb.hidden) return;
    var i = carIndex($("#lbTrack"));
    hideLayer(lb);
    lbId = null;
    var t = $("#detail .car-track");
    if (t) carGo(t, i, false);
  }

  /* ---------- Роутинг по #адресу (кнопка «назад» закрывает окна) ---------- */
  function route() {
    var h = decodeURIComponent(location.hash.slice(1));
    var m = h.match(/^([a-z-]+)(?:\/(\d+))?(?:\/(\d+))?$/);
    if (!m) return { cat: null };
    if (m[1] === "filters" || m[1] === "contacts") return { cat: null, panel: m[1] };
    return { cat: m[1], id: m[2] ? +m[2] : null, photo: m[3] ? +m[3] : null };
  }

  var pendingIndex = 0;
  function apply() {
    var r = route();
    if (r.cat && r.cat !== S.cat.id && SITE.categories.some(function (c) { return c.id === r.cat; })) setCategory(r.cat);
    r.panel === "filters" ? showLayer($("#filtersLayer")) : hideLayer($("#filtersLayer"));
    r.panel === "contacts" ? showLayer($("#contactsLayer")) : hideLayer($("#contactsLayer"));
    if (r.id && S.byId[r.id]) {
      openDetailUI(r.id, r.photo ? r.photo - 1 : pendingIndex);
      if (r.photo) openLightboxUI(r.id, r.photo - 1); else closeLightboxUI();
    } else {
      closeLightboxUI();
      closeDetailUI();
    }
    pendingIndex = 0;
  }

  function go(hash) {
    history.pushState({ ff: true }, "", hash);
    apply();
  }

  function closeTop() {
    if (history.state && history.state.ff) { history.back(); return; }
    // Пришли по прямой ссылке — возвращаемся «на уровень выше» без выхода с сайта
    var r = route(), up = "#" + S.cat.id;
    if (r.photo) up = "#" + r.cat + "/" + r.id;
    history.replaceState(null, "", up);
    apply();
  }

  window.addEventListener("popstate", apply);
  window.addEventListener("hashchange", apply);

  /* ---------- Обработчики ---------- */
  function updatePick(id, kind, value) {
    var p = S.byId[id];
    sel(p)[kind] = value;
    $$('[data-pick="' + kind + '"][data-id="' + id + '"]').forEach(function (b) {
      var on = b.dataset.value === value;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on);
    });
    $$('[data-wa-item="' + id + '"]').forEach(function (a) { a.href = waHref(message(p)); });
    $$('[data-tg-item="' + id + '"]').forEach(function (a) { a.href = tgHref(message(p)); });
    if (S.cart.indexOf(p) >= 0) renderCart();  // выбранный размер/цвет попадёт и в заявку из корзины
  }

  /* ---------- Корзина (только в памяти страницы) ---------- */
  function findByKey(key) {
    var parts = key.split(":"), list = S.prepared[parts[0]] || [];
    return list.filter(function (p) { return String(p.id) === parts[1]; })[0];
  }

  function toggleCart(p) {
    var i = S.cart.indexOf(p);
    if (i >= 0) S.cart.splice(i, 1); else S.cart.push(p);
    syncCartButtons(p);
    renderCart();
    var n = S.cart.length;
    toast(i >= 0 ? "Убрано из корзины" : "В корзине " + models(n) + " — отправьте всё одним сообщением");
  }

  function syncCartButtons(p) {
    var on = S.cart.indexOf(p) >= 0;
    $$('[data-cart="' + keyOf(p) + '"]').forEach(function (b) {
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on);
      $("use", b).setAttribute("href", "#i-" + (on ? "check" : "bag"));
      var label = $("span", b);
      if (label) label.textContent = on ? "В корзине" : "В корзину";
      else b.setAttribute("aria-label", on ? "Убрать из корзины" : "Положить в корзину");
    });
  }

  function renderCart() {
    var bar = $("#cartbar"), n = S.cart.length;
    var mixed = S.cart.some(function (p) { return p.cat !== S.cart[0].cat; });
    bar.classList.toggle("is-shown", n > 0);
    bar.setAttribute("aria-hidden", n === 0);
    document.documentElement.classList.toggle("has-cart", n > 0);
    if (!n) return;
    $("#cartTitle").textContent = "Корзина · " + models(n);
    $("#cartItems").innerHTML = S.cart.map(function (p) {
      var k = keyOf(p);
      return '<div class="cchip"><button class="cchip-open" type="button" data-cart-open="' + k + '">' +
        '<img src="' + p.thumbs[0] + '" alt="">' +
        "<span><b>" + (mixed ? esc(cap(p.cat.one)) + " " : "") + "№ " + p.id + "</b><small>" + esc(p.name) + "</small></span></button>" +
        '<button class="cchip-x" type="button" data-cart-remove="' + k + '" aria-label="Убрать «' + esc(p.name) + '» из корзины">' + icon("x") + "</button></div>";
    }).join("");
    $("#cartWa").href = waHref(cartMessage());
    $("#cartTg").href = tgHref(cartMessage());
    document.documentElement.style.setProperty("--cart-h", bar.offsetHeight + "px");
  }

  function scrollToResults() {
    var tb = $("#toolbar");
    var top = tb.getBoundingClientRect().top + scrollY;
    if (scrollY > top) scrollTo({ top: top, behavior: "smooth" });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("a, button");
    if (!t) return;
    var d = t.dataset;

    if (d.step) { e.preventDefault(); var tr = $(".car-track", t.closest("[data-car]")); carGo(tr, carIndex(tr) + +d.step, true); return; }

    if (d.open && !t.closest("#detail")) {
      e.preventDefault();
      pendingIndex = +d.i || 0;
      go("#" + S.cat.id + "/" + d.open);
      return;
    }
    if (d.open && t.closest("#detail")) { e.preventDefault(); go("#" + S.cat.id + "/" + d.open + "/" + ((+d.i || 0) + 1)); return; }
    if (d.zoom !== undefined && detailId) { go("#" + S.cat.id + "/" + detailId + "/" + (carIndex($("#detail .car-track")) + 1)); return; }
    if (d.thumb) { carGo($("#detail .car-track"), +d.thumb, true); return; }
    if (d.lb) { var lt = $("#lbTrack"); carGo(lt, carIndex(lt) + +d.lb, true); return; }

    if (d.pick) { updatePick(+d.id, d.pick, d.value); return; }

    if (d.cart) { toggleCart(findByKey(d.cart)); return; }
    if (d.cartRemove) { var rp = findByKey(d.cartRemove); toggleCart(rp); return; }
    if (d.cartOpen) { var op = findByKey(d.cartOpen); go("#" + op.cat.id + "/" + op.id); return; }
    if (d.cartClear !== undefined) {
      if (!confirm("Очистить корзину?")) return;
      var was = S.cart.slice(); S.cart = [];
      was.forEach(syncCartButtons); renderCart(); toast("Корзина очищена");
      return;
    }
    if (t.id === "cartWa") { t.href = waHref(cartMessage()); return; }
    if (t.id === "cartTg") { t.href = tgHref(cartMessage()); return; }

    if (d.waItem) { t.href = waHref(message(S.byId[+d.waItem])); return; }
    if (d.tgItem) { t.href = tgHref(message(S.byId[+d.tgItem])); return; }
    if (d.share) {
      var sp = S.byId[+d.share];
      var url = isHttp ? shareUrl(sp) : location.href;
      if (navigator.share) {
        navigator.share({ title: sp.cat.one + " «" + sp.name + "» — " + SITE.brand, text: "№ " + sp.id + " — " + sp.cat.one + " «" + sp.name + "»", url: url }).catch(function () {});
      } else {
        copy(url).then(function () { toast("Ссылка на модель скопирована"); }, function () {});
      }
      return;
    }

    if (d.type) {
      S.type = d.type;
      render();
      if (!t.closest(".filters")) scrollToResults();
      return;
    }
    if (d.producer) {
      var i = S.producers.indexOf(d.producer);
      i >= 0 ? S.producers.splice(i, 1) : S.producers.push(d.producer);
      syncFilterControls();
      render();
      return;
    }
    if (d.clear === "len") { S.lenMin = S.bounds.min; S.lenMax = S.bounds.max; syncFilterControls(); render(); return; }
    if (d.clear === "producer") { S.producers = S.producers.filter(function (x) { return x !== d.value; }); syncFilterControls(); render(); return; }
    if (d.reset !== undefined) { resetFilters(false); return; }

    if (d.close !== undefined) { e.preventDefault(); closeTop(); return; }
    if (d.openContacts !== undefined) { go("#contacts"); return; }
    if (t.id === "filterBtn") { go("#filters"); return; }
    if (t.id === "qClear") { $("#q").value = ""; S.q = ""; render(); $("#q").focus(); return; }
    if (t.id === "toTop") { scrollTo({ top: 0, behavior: "smooth" }); return; }
  });

  // Клик по затемнению
  $$(".layer-scrim").forEach(function (s) { s.addEventListener("click", closeTop); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.querySelector(".layer.is-open, .lightbox.is-open")) { closeTop(); return; }
    if (!$("#lightbox").hidden && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      var lt = $("#lbTrack"); carGo(lt, carIndex(lt) + (e.key === "ArrowLeft" ? -1 : 1), true);
    } else if (detailId && $("#lightbox").hidden && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      var dt = $("#detail .car-track"); carGo(dt, carIndex(dt) + (e.key === "ArrowLeft" ? -1 : 1), true);
    }
  });

  // Поиск
  var q = $("#q");
  q.addEventListener("input", debounce(function () { S.q = q.value; render(); }, 120));
  q.addEventListener("keydown", function (e) { if (e.key === "Enter") { q.blur(); scrollToResults(); } });

  $("#sort").addEventListener("change", function () { S.sort = this.value; render(); });

  // Липкая панель и кнопка «наверх»
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      $("#toolbar").classList.toggle("is-stuck", $("#toolbar").getBoundingClientRect().top <= 0.5);
      $("#toTop").classList.toggle("is-shown", scrollY > 1400);
    });
  }, { passive: true });
  window.addEventListener("resize", debounce(function () { if (S.cart.length) renderCart(); }, 150));

  /* ---------- Контакты ---------- */
  function renderContacts() {
    var genericWa = waHref("Здравствуйте! Хочу подобрать мебель в " + SITE.brand + ".");
    var html =
      '<a class="contact-row" href="' + esc(genericWa) + '" target="_blank" rel="noopener"><span class="ci ci--wa">' + icon("wa") + "</span>" +
        "<span><b>WhatsApp</b><small>" + esc(SITE.phone) + '</small></span><img class="qr" src="assets/img/qr-whatsapp.jpg" alt="QR-код WhatsApp" loading="lazy"></a>' +
      '<a class="contact-row" href="' + TG_HREF + '" target="_blank" rel="noopener"><span class="ci ci--tg">' + icon("tg") + "</span>" +
        "<span><b>Telegram</b><small>@" + esc(SITE.telegram) + '</small></span><img class="qr" src="assets/img/qr-telegram.jpg" alt="QR-код Telegram" loading="lazy"></a>' +
      '<a class="contact-row" href="' + SITE.phoneHref + '"><span class="ci ci--call">' + icon("phone") + "</span>" +
        "<span><b>Позвонить</b><small>" + esc(SITE.phone) + "</small></span></a>";
    $$("[data-contact-list]").forEach(function (el) { el.innerHTML = html; });
    $$("[data-wa]").forEach(function (a) { a.href = genericWa; });
    $$("[data-tg]").forEach(function (a) { a.href = TG_HREF; });
    $$("[data-phone]").forEach(function (a) { a.href = SITE.phoneHref; a.textContent = SITE.phone; });
    $("#year").textContent = new Date().getFullYear();
  }

  /* ---------- Старт ---------- */
  renderContacts();
  bindFilters();
  $$(".sheet").forEach(dragToClose);
  var r0 = route();
  setCategory(r0.cat || SITE.categories[0].id);
  apply();
})();
