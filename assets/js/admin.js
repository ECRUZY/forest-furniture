/* ==========================================================================
   Forest Furniture — админка
   Сайт статичный, поэтому изменения сохраняются коммитом в GitHub-репозиторий
   сайта (GitHub Pages / Netlify / Vercel пересобирают сайт сами).

   Доступ: личная ссылка admin.html#key=… В ней зашифрованы репозиторий и токен
   GitHub (AES-GCM, ключ из пароля через PBKDF2). Без пароля ссылка бесполезна,
   а часть после # браузер никогда не отправляет на сервер.
   ========================================================================== */
(function () {
  "use strict";

  var SITE = window.SITE;
  var API = "https://api.github.com";

  /* ---------- Утилиты ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name) { return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function plural(n, f) { var a = n % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; }
  function show(id) { ["screenSetup", "screenPin", "screenApp"].forEach(function (s) { $("#" + s).hidden = s !== id; }); }
  function storage(kind) { try { return window[kind]; } catch (e) { return null; } }
  var SS = storage("sessionStorage"), LS = storage("localStorage");

  var toastTimer;
  function toast(text) {
    var t = $("#toast");
    t.textContent = text;
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-shown"); }, 3600);
  }
  function busy(text) { $("#busy").hidden = !text; if (text) $("#busyText").textContent = text; }
  function fail(box, err) { box.textContent = err.message || String(err); box.hidden = false; }

  // Основной адрес сайта для превью-ссылок: из config.js, из личной ссылки или по месту, где открыта админка.
  // На Vercel у каждой сборки есть свой временный адрес — превью должны вести на основной.
  function normBase(u) { return String(u).trim().replace(/\/?$/, "/"); }
  var HERE = location.origin + location.pathname.replace(/[^/]*$/, "");
  function siteBase() { return normBase(SITE.siteUrl || (C && C.site) || HERE); }

  /* ---------- Шифрование личной ссылки ---------- */
  var te = new TextEncoder(), td = new TextDecoder();
  function b64u(bytes) {
    var s = ""; bytes.forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    var s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, function (c) { return c.charCodeAt(0); });
  }
  function deriveKey(pass, salt) {
    return crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 310000, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  async function seal(obj, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, await deriveKey(pass, salt), te.encode(JSON.stringify(obj))));
    var out = new Uint8Array(1 + 16 + 12 + ct.length);
    out[0] = 1; out.set(salt, 1); out.set(iv, 17); out.set(ct, 29);
    return b64u(out);
  }
  async function unseal(key, pass) {
    var raw = unb64u(key);
    if (raw[0] !== 1) throw new Error("Ссылка повреждена");
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(17, 29) }, await deriveKey(pass, raw.slice(1, 17)), raw.slice(29));
    return JSON.parse(td.decode(pt));
  }

  /* ---------- GitHub API ---------- */
  var C = null; // { repo, branch, token }

  async function gh(path, opts, creds) {
    opts = opts || {};
    var r = await fetch(API + path, {
      method: opts.method || "GET",
      headers: {
        Authorization: "Bearer " + (creds || C).token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    if (r.ok) return r.status === 204 ? null : r.json();
    var msg = "";
    try { msg = (await r.json()).message || ""; } catch (e) {}
    var text = {
      401: "Токен GitHub недействителен или истёк — создайте новую личную ссылку.",
      403: "GitHub отказал в доступе. Проверьте, что у токена есть Contents: Read and write.",
      404: "Репозиторий или ветка не найдены (или у токена нет к ним доступа).",
      409: "В репозитории одновременно идут другие изменения — попробуйте ещё раз.",
      422: "GitHub не принял изменения.",
    }[r.status] || "Ошибка GitHub (" + r.status + ").";
    throw new Error(text + (msg ? " [" + msg + "]" : ""));
  }

  function normRepo(s) {
    return s.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  }

  async function verify(creds) {
    var repo = await gh("/repos/" + creds.repo, null, creds);
    if (repo.permissions && !repo.permissions.push) throw new Error("У этого аккаунта нет права записи в репозиторий.");
    await gh("/repos/" + creds.repo + "/branches/" + encodeURIComponent(creds.branch), null, creds);
  }

  function decodeB64Utf8(b64) { return td.decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), function (c) { return c.charCodeAt(0); })); }

  // Свежее состояние репозитория: последний коммит, все пути файлов и данные раздела
  async function loadRepo(cat) {
    var ref = await gh("/repos/" + C.repo + "/git/ref/heads/" + encodeURIComponent(C.branch));
    var commit = await gh("/repos/" + C.repo + "/git/commits/" + ref.object.sha);
    var tree = await gh("/repos/" + C.repo + "/git/trees/" + commit.tree.sha + "?recursive=1");
    var paths = {};
    tree.tree.forEach(function (t) { if (t.type === "blob") paths[t.path] = t.sha; });
    var dataPath = "data/" + cat.id + ".js";
    var parsed = { head: defaultHead(cat), items: [] };
    if (paths[dataPath]) {
      var blob = await gh("/repos/" + C.repo + "/git/blobs/" + paths[dataPath]);
      parsed = parseData(decodeB64Utf8(blob.content), cat);
    }
    return { commit: ref.object.sha, tree: commit.tree.sha, paths: paths, dataPath: dataPath, head: parsed.head, items: parsed.items };
  }

  async function uploadBlob(b64) {
    return (await gh("/repos/" + C.repo + "/git/blobs", { method: "POST", body: { content: b64, encoding: "base64" } })).sha;
  }

  // Один коммит со всеми изменениями: [{ path, content } | { path, sha } | { path, remove: true }]
  async function commit(repo, message, entries) {
    var tree = await gh("/repos/" + C.repo + "/git/trees", { method: "POST", body: {
      base_tree: repo.tree,
      tree: entries.map(function (e) {
        var t = { path: e.path, mode: "100644", type: "blob" };
        if (e.remove) t.sha = null; else if (e.content != null) t.content = e.content; else t.sha = e.sha;
        return t;
      }),
    } });
    var c = await gh("/repos/" + C.repo + "/git/commits", { method: "POST", body: { message: message, tree: tree.sha, parents: [repo.commit] } });
    await gh("/repos/" + C.repo + "/git/refs/heads/" + encodeURIComponent(C.branch), { method: "PATCH", body: { sha: c.sha } });
    return c.sha;
  }

  /* ---------- Файл данных раздела (data/<раздел>.js) ---------- */
  function marker(cat) { return "window.CATALOG." + cat.id + " = ["; }
  function defaultHead(cat) {
    return "/*\n * Каталог: " + cat.title.toUpperCase() + "\n * Формат — см. data/kitchens.js\n */\nwindow.CATALOG = window.CATALOG || {};\n" + marker(cat);
  }
  function parseData(text, cat) {
    var i = text.indexOf(marker(cat));
    if (i < 0) throw new Error("Не нашёл список моделей в data/" + cat.id + ".js");
    var head = text.slice(0, i + marker(cat).length);
    var body = text.slice(i + marker(cat).length, text.lastIndexOf("];")).trim().replace(/,\s*$/, "");
    return { head: head, items: JSON.parse("[" + body + "]") };
  }
  // Последний выданный номер хранится в шапке файла, чтобы номер удалённой модели
  // не достался новой (иначе старые ссылки и переписки укажут на другую кухню)
  var LAST_ID = /\/\/ Последний выданный номер: (\d+)\n/;
  function nextId(repo) {
    var m = repo.head.match(LAST_ID);
    return repo.items.reduce(function (mx, p) { return Math.max(mx, p.id); }, m ? +m[1] : 0) + 1;
  }
  function withLastId(head, id) {
    var line = "// Последний выданный номер: " + id + "\n";
    if (LAST_ID.test(head)) return head.replace(LAST_ID, function (all, cur) { return +cur >= id ? all : line; });
    var at = head.indexOf("window.CATALOG = ");
    return at < 0 ? line + head : head.slice(0, at) + line + head.slice(at);
  }
  // Формат строки как в исходном файле: одна модель — одна строка
  function fmt(o) {
    return "{" + Object.keys(o).map(function (k) {
      var v = o[k];
      return JSON.stringify(k) + ": " + (Array.isArray(v) ? "[" + v.map(function (x) { return JSON.stringify(x); }).join(", ") + "]" : JSON.stringify(v));
    }).join(", ") + "}";
  }
  function buildData(head, items) {
    return head + "\n" + items.map(function (o) { return "  " + fmt(o) + ","; }).join("\n") + "\n];\n";
  }

  /* ---------- Страница-превью модели (карточка в WhatsApp/Telegram) ---------- */
  function sharePage(p, cat) {
    var url = siteBase() + cat.id + "/" + p.id + "/";
    var img = siteBase() + "photos/" + cat.id + "/thumbs/" + p.id + "_1.jpg?v=" + Date.now().toString(36);
    var title = cap(cat.one) + " «" + p.name + "» · № " + p.id;
    var desc = [p.type, p.sizes.length ? p.sizes.join(" / ") + " см" : "", p.colors.join(", "), p.producer].filter(Boolean).join(" · ");
    var target = "../../#" + cat.id + "/" + p.id;
    return [
      "<!DOCTYPE html>",
      '<html lang="ru"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + esc(title) + " — " + esc(SITE.brand) + "</title>",
      '<meta name="description" content="' + esc(desc) + '">',
      '<link rel="canonical" href="' + esc(url) + '">',
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="' + esc(SITE.brand) + '">',
      '<meta property="og:locale" content="ru_RU">',
      '<meta property="og:title" content="' + esc(title) + '">',
      '<meta property="og:description" content="' + esc(desc) + '">',
      '<meta property="og:url" content="' + esc(url) + '">',
      '<meta property="og:image" content="' + esc(img) + '">',
      '<meta property="og:image:alt" content="' + esc(title) + '">',
      '<meta name="twitter:card" content="summary_large_image">',
      // Людей сразу перекидываем в каталог; роботы мессенджеров JS не выполняют и читают og-теги
      "<script>location.replace(" + JSON.stringify(target).replace(/</g, "\\u003c") + ");</script>",
      "<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#1B1A17;background:#F3EFE8}img{width:100%;border-radius:16px}a{color:inherit}</style>",
      "</head><body>",
      '<img src="../../photos/' + cat.id + "/thumbs/" + p.id + '_1.jpg" alt="">',
      "<h1>" + esc(title) + "</h1><p>" + esc(desc) + "</p>",
      '<p><a href="' + esc(target) + '">Открыть в каталоге ' + esc(SITE.brand) + "</a></p>",
      "</body></html>",
      "",
    ].join("\n");
  }

  /* ---------- Фото: сжатие в браузере ---------- */
  function readImage(file) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok({ img: img, url: url }); };
      img.onerror = function () { no(new Error("Не получилось открыть «" + file.name + "». Нужен JPEG или PNG (фото с iPhone в HEIC сохраните как JPEG).")); };
      img.src = url;
    });
  }
  function toJpeg(img, max, quality) {
    var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); // прозрачный PNG → белый фон
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality).split(",")[1];
  }

  /* ---------- Состояние админки ---------- */
  var S = { cat: SITE.categories[0], repo: null, q: "" };
  var E = null; // редактируемая модель

  function rawUrl(path) {
    // Свежие фото из репозитория (сайт обновляется с задержкой); если репозиторий закрытый — с сайта
    return "https://raw.githubusercontent.com/" + C.repo + "/" + S.repo.commit + "/" + path;
  }
  function photoSrc(id, n, thumb) {
    return "photos/" + S.cat.id + "/" + (thumb ? "thumbs/" : "") + id + "_" + n + ".jpg";
  }
  function imgTag(path, alt) {
    return '<img src="' + esc(rawUrl(path)) + '" alt="' + esc(alt || "") + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + esc(path) + '\'">';
  }

  async function reload() {
    S.repo = await loadRepo(S.cat);
    renderList();
  }

  function renderCats() {
    $("#aCats").innerHTML = SITE.categories.map(function (c) {
      return '<button class="cat-tab' + (c === S.cat ? " is-active" : "") + '" type="button" data-cat="' + c.id + '">' + esc(c.title) + "</button>";
    }).join("");
  }

  function renderList() {
    var q = S.q.toLowerCase().replace(/[№#]/g, "").trim();
    var items = S.repo.items.slice().sort(function (a, b) { return b.id - a.id; }).filter(function (p) {
      return !q || String(p.id) === q || (p.name + " " + p.producer).toLowerCase().indexOf(q) >= 0;
    });
    var n = S.repo.items.length;
    $("#aCount").textContent = S.cat.title + ": " + n + " " + plural(n, ["модель", "модели", "моделей"]) + (q ? " · найдено " + items.length : "");
    $("#aList").innerHTML = items.map(function (p) {
      return '<button class="a-item" type="button" data-edit="' + p.id + '">' + imgTag(photoSrc(p.id, 1, true)) +
        "<span><b>" + esc(p.name) + "</b><small>" + esc([p.type, p.sizes.join(" / "), p.producer].filter(Boolean).join(" · ")) + "</small></span>" +
        '<span class="tag tag--num">№ ' + p.id + "</span></button>";
    }).join("") || '<p class="muted">Ничего не найдено</p>';
  }

  /* ---------- Слои ---------- */
  var timers = {};
  function openLayer(el) {
    clearTimeout(timers[el.id]);
    el.hidden = false; el.offsetHeight; el.classList.add("is-open");
    document.documentElement.classList.add("is-locked");
    history.pushState({ adm: el.id }, "", location.href); // «назад» на телефоне закрывает окно
  }
  function hideLayer(el) {
    if (el.hidden) return;
    el.classList.remove("is-open");
    timers[el.id] = setTimeout(function () { el.hidden = true; }, 380);
    if (!$(".layer.is-open")) document.documentElement.classList.remove("is-locked");
  }
  function closeLayer(el) {
    if (el.id === "editLayer" && E && E.dirty && !confirm("Закрыть без сохранения?")) return;
    if (history.state && history.state.adm === el.id) history.back(); else hideLayer(el);
  }
  window.addEventListener("popstate", function () {
    $$(".layer.is-open").forEach(function (l) {
      if (l.id === "editLayer" && E && E.dirty && !confirm("Закрыть без сохранения?")) { history.pushState({ adm: l.id }, "", location.href); return; }
      hideLayer(l);
    });
  });

  /* ---------- Редактор ---------- */
  function openEditor(item) {
    var isNew = !item;
    E = {
      isNew: isNew,
      id: isNew ? nextId(S.repo) : item.id,
      photos: isNew ? [] : Array.from({ length: item.photos }, function (_, i) { return { old: i + 1 }; }),
      dirty: false,
    };
    var f = $("#editForm");
    f.reset();
    $("#eType").innerHTML = S.cat.types.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    var producers = {};
    S.repo.items.forEach(function (p) { if (p.producer) producers[p.producer] = 1; });
    $("#eProducers").innerHTML = Object.keys(producers).sort().map(function (p) { return '<option value="' + esc(p) + '">'; }).join("");
    f.id.value = "№ " + E.id;
    f.type.value = isNew ? S.cat.types[0] : item.type;
    f.name.value = isNew ? "" : item.name;
    f.producer.value = isNew ? "" : item.producer;
    f.sizes.value = isNew ? "" : item.sizes.join(", ");
    f.colors.value = isNew ? "" : item.colors.join(", ");
    f.desc.value = isNew ? "" : item.desc;
    $("#eTitle").textContent = isNew ? "Новая модель" : "№ " + item.id + " · " + item.name;
    $("#deleteBtn").hidden = isNew;
    $("#editError").hidden = true;
    renderPhotos();
    openLayer($("#editLayer"));
    $("#editLayer .sheet-scroll").scrollTop = 0;
  }

  function renderPhotos() {
    var n = E.photos.length;
    $("#ePhotos").innerHTML = E.photos.map(function (ph, i) {
      var img = ph.old ? imgTag(photoSrc(E.id, ph.old, true)) : '<img src="' + ph.url + '" alt="">';
      return '<div class="photo' + (i === 0 ? " is-main" : "") + '">' + img +
        '<span class="photo-num">' + (i + 1) + "</span>" + (ph.old ? "" : '<span class="photo-new">новое</span>') +
        '<div class="photo-tools">' +
          '<button type="button" data-move="' + i + '" data-dir="-1" aria-label="Левее"' + (i === 0 ? " disabled" : "") + ">" + icon("left") + "</button>" +
          '<button type="button" data-drop="' + i + '" aria-label="Убрать фото">' + icon("trash") + "</button>" +
          '<button type="button" data-move="' + i + '" data-dir="1" aria-label="Правее"' + (i === n - 1 ? " disabled" : "") + ">" + icon("right") + "</button>" +
        "</div></div>";
    }).join("");
  }

  async function addFiles(files) {
    var list = Array.prototype.slice.call(files);
    for (var i = 0; i < list.length; i++) {
      busy("Сжимаю фото " + (i + 1) + " из " + list.length + "…");
      try {
        var r = await readImage(list[i]);
        E.photos.push({ url: r.url, full: toJpeg(r.img, 1600, 0.82), thumb: toJpeg(r.img, 800, 0.6) });
        E.dirty = true;
      } catch (err) { toast(err.message); }
    }
    busy(false);
    renderPhotos();
  }

  function splitList(s) { return s.split(/\s*[,;]\s*|\s+\/\s+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function normSize(s) { return s.replace(/см\.?/gi, "").replace(/\s+/g, "").replace(/[xхXХ*]/g, "×"); }

  function readForm() {
    var f = $("#editForm");
    var rec = {
      id: E.id,
      name: f.name.value.trim(),
      type: f.type.value,
      producer: f.producer.value.trim(),
      colors: splitList(f.colors.value).map(cap),
      sizes: splitList(f.sizes.value).map(normSize),
      desc: f.desc.value.replace(/\s*\n\s*/g, ", ").trim().replace(/,\s*$/, ""),
      photos: E.photos.length,
    };
    if (!rec.name) throw new Error("Укажите название.");
    if (!rec.photos) throw new Error("Добавьте хотя бы одно фото.");
    var bad = rec.sizes.filter(function (s) { return !/^\d+([.,]\d+)?(×\d+([.,]\d+)?)*$/.test(s); });
    if (bad.length) throw new Error("Не понял размер: " + bad.join(", ") + ". Пишите числа в см, например 300 или 395×275.");
    return rec;
  }

  async function save() {
    var rec = readForm();
    busy("Проверяю репозиторий…");
    var repo = await loadRepo(S.cat);
    var base = "photos/" + S.cat.id + "/";
    var prev = repo.items.filter(function (p) { return p.id === E.id; })[0];
    if (E.isNew) {
      // Пока форма была открыта, номер мог занять кто-то ещё
      rec.id = nextId(repo);
    } else if (!prev) {
      throw new Error("Модель № " + E.id + " уже удалена из репозитория.");
    }
    var id = rec.id, entries = [];
    var toUpload = E.photos.filter(function (p) { return !p.old; }).length, uploaded = 0;

    for (var i = 0; i < E.photos.length; i++) {
      var ph = E.photos[i], n = i + 1;
      var full = base + id + "_" + n + ".jpg", thumb = base + "thumbs/" + id + "_" + n + ".jpg";
      if (ph.old) {
        if (ph.old === n) continue; // фото осталось на своём месте
        var fs = repo.paths[base + id + "_" + ph.old + ".jpg"];
        var ts = repo.paths[base + "thumbs/" + id + "_" + ph.old + ".jpg"] || fs;
        if (!fs) throw new Error("В репозитории нет фото " + id + "_" + ph.old + ".jpg");
        entries.push({ path: full, sha: fs }, { path: thumb, sha: ts });
      } else {
        busy("Загружаю фото " + (++uploaded) + " из " + toUpload + "…");
        entries.push({ path: full, sha: await uploadBlob(ph.full) }, { path: thumb, sha: await uploadBlob(ph.thumb) });
      }
    }
    // Лишние старые фото (если их стало меньше)
    for (var k = E.photos.length + 1; k <= (prev ? prev.photos : 0); k++) {
      [base + id + "_" + k + ".jpg", base + "thumbs/" + id + "_" + k + ".jpg"].forEach(function (p) {
        if (repo.paths[p]) entries.push({ path: p, remove: true });
      });
    }
    var items = repo.items.filter(function (p) { return p.id !== id; }).concat([rec]).sort(function (a, b) { return a.id - b.id; });
    entries.push({ path: repo.dataPath, content: buildData(withLastId(repo.head, id), items) });
    entries.push({ path: S.cat.id + "/" + id + "/index.html", content: sharePage(rec, S.cat) });

    busy("Сохраняю…");
    await commit(repo, (E.isNew ? "Админка: добавлена модель № " : "Админка: изменена модель № ") + id + " «" + rec.name + "»", entries);
    E.dirty = false;
    await reload();
    busy(false);
    closeLayer($("#editLayer"));
    toast("Сохранено: № " + id + " «" + rec.name + "». На сайте появится через 1–2 минуты.");
  }

  async function removeItem() {
    var repo = S.repo, p = repo.items.filter(function (x) { return x.id === E.id; })[0];
    if (!p || !confirm("Удалить модель № " + p.id + " «" + p.name + "» вместе с фото?")) return;
    busy("Удаляю…");
    repo = await loadRepo(S.cat);
    p = repo.items.filter(function (x) { return x.id === E.id; })[0];
    if (!p) throw new Error("Модель уже удалена.");
    var base = "photos/" + S.cat.id + "/", entries = [];
    for (var k = 1; k <= p.photos; k++) {
      [base + p.id + "_" + k + ".jpg", base + "thumbs/" + p.id + "_" + k + ".jpg"].forEach(function (path) {
        if (repo.paths[path]) entries.push({ path: path, remove: true });
      });
    }
    var page = S.cat.id + "/" + p.id + "/index.html";
    if (repo.paths[page]) entries.push({ path: page, remove: true });
    var maxId = repo.items.reduce(function (mx, x) { return Math.max(mx, x.id); }, 0);
    entries.push({ path: repo.dataPath, content: buildData(withLastId(repo.head, maxId), repo.items.filter(function (x) { return x.id !== p.id; })) });
    await commit(repo, "Админка: удалена модель № " + p.id + " «" + p.name + "»", entries);
    E.dirty = false;
    await reload();
    busy(false);
    closeLayer($("#editLayer"));
    toast("Модель № " + p.id + " удалена. Её номер больше не используется.");
  }

  async function rebuildShare() {
    if (/^https?:\/\/(localhost|127\.)/.test(siteBase()) &&
      !confirm("Превью будут вести на " + siteBase() + " — мессенджеры не увидят такой адрес. Укажите основной адрес сайта при создании личной ссылки. Продолжить?")) return;
    busy("Создаю превью-ссылки…");
    var repo = await loadRepo(S.cat);
    var entries = repo.items.map(function (p) { return { path: S.cat.id + "/" + p.id + "/index.html", content: sharePage(p, S.cat) }; });
    await commit(repo, "Админка: превью-ссылки для раздела «" + S.cat.title + "»", entries);
    await reload();
    busy(false);
    closeLayer($("#menuLayer"));
    toast("Готово: " + entries.length + " " + plural(entries.length, ["превью", "превью", "превью"]) + " для " + siteBase());
  }

  /* ---------- Экраны входа ---------- */
  function keyFromHash() { return new URLSearchParams(location.hash.slice(1)).get("key"); }

  function sessionCreds(key) {
    try { var s = JSON.parse(SS.getItem("ff-admin") || "null"); return s && s.key === key ? s.creds : null; } catch (e) { return null; }
  }

  function prefillSetup(creds) {
    var f = $("#setupForm");
    var m = location.hostname.match(/^([^.]+)\.github\.io$/);
    f.site.value = (creds && creds.site) || SITE.siteUrl || HERE;
    if (creds) { f.repo.value = creds.repo; f.branch.value = creds.branch; f.token.value = creds.token; }
    else if (m) { var seg = location.pathname.split("/")[1]; f.repo.value = m[1] + "/" + (seg && !/\.html$/.test(seg) ? seg : m[1] + ".github.io"); }
    $("#setupDone").hidden = true;
    f.hidden = false;
    show("screenSetup");
  }

  async function start(creds) {
    C = creds;
    show("screenApp");
    $("#menuRepo").textContent = "Репозиторий: " + C.repo + " (" + C.branch + ") · сайт: " + siteBase();
    renderCats();
    try { await reload(); } catch (err) { $("#aList").innerHTML = '<p class="form-error">' + esc(err.message) + "</p>"; }
  }

  async function init() {
    if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
      show("screenSetup");
      $("#setupForm").hidden = true;
      $("#screenSetup .steps").outerHTML = '<p class="form-error">Админка работает только по защищённому адресу (https). Откройте её на опубликованном сайте.</p>';
      return;
    }
    var key = keyFromHash();
    var creds = key && sessionCreds(key);
    if (creds) return start(creds);
    if (key) { $("#pinError").hidden = true; $("#pinForm").reset(); show("screenPin"); return; }
    prefillSetup(null);
  }
  window.addEventListener("hashchange", init);

  $("#setupForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target, err = $("#setupError");
    err.hidden = true;
    try {
      if (f.pin.value.length < 8) throw new Error("Пароль — минимум 8 символов.");
      if (f.pin.value !== f.pin2.value) throw new Error("Пароли не совпадают.");
      var creds = { repo: normRepo(f.repo.value), branch: f.branch.value.trim(), token: f.token.value.trim(), site: normBase(f.site.value) };
      if (!/^[\w.-]+\/[\w.-]+$/.test(creds.repo)) throw new Error("Репозиторий пишется как владелец/название, например ivan/forest-furniture.");
      if (!/^https?:\/\/[^/]+/.test(creds.site)) throw new Error("Адрес сайта должен начинаться с https://, например https://forest-furniture.vercel.app");
      busy("Проверяю доступ к GitHub…");
      await verify(creds);
      var link = location.origin + location.pathname + "#key=" + (await seal(creds, f.pin.value));
      busy(false);
      f.reset();
      f.hidden = true;
      $("#adminLink").value = link;
      $("#openLink").href = link;
      $("#setupDone").hidden = false;
    } catch (ex) { busy(false); fail(err, ex); }
  });

  $("#copyLink").addEventListener("click", function () {
    var inp = $("#adminLink");
    (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(
      function () { toast("Ссылка скопирована"); },
      function () { inp.select(); document.execCommand("copy"); toast("Ссылка скопирована"); });
  });

  // Небольшая пауза после неудачных попыток, чтобы пароль было неудобно подбирать вручную
  $("#pinForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("#pinError"), key = keyFromHash();
    var lock = +(LS && LS.getItem("ff-admin-lock")) || 0;
    if (Date.now() < lock) return fail(err, new Error("Слишком много попыток. Подождите " + Math.ceil((lock - Date.now()) / 1000) + " с."));
    busy("Проверяю пароль…");
    try {
      var creds = await unseal(key, e.target.pin.value);
      busy("Проверяю доступ к GitHub…");
      await verify(creds);
      if (LS) LS.removeItem("ff-admin-fails");
      if (SS) SS.setItem("ff-admin", JSON.stringify({ key: key, creds: creds }));
      busy(false);
      start(creds);
    } catch (ex) {
      busy(false);
      if (ex.name === "OperationError") {
        var fails = (+(LS && LS.getItem("ff-admin-fails")) || 0) + 1;
        if (LS) { LS.setItem("ff-admin-fails", fails); if (fails >= 5) { LS.setItem("ff-admin-lock", Date.now() + 60000); LS.setItem("ff-admin-fails", 0); } }
        fail(err, new Error("Неверный пароль."));
      } else fail(err, ex);
    }
  });

  /* ---------- Обработчики админки ---------- */
  var debounceQ;
  $("#aQ").addEventListener("input", function () {
    clearTimeout(debounceQ);
    var v = this.value;
    debounceQ = setTimeout(function () { S.q = v; renderList(); }, 120);
  });
  $("#eFiles").addEventListener("change", function () { addFiles(this.files).then(function () { $("#eFiles").value = ""; }); });
  $("#editForm").addEventListener("input", function () { if (E) E.dirty = true; });
  $("#editForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("#editError").hidden = true;
    save().catch(function (ex) { busy(false); fail($("#editError"), ex); });
  });
  $("#deleteBtn").addEventListener("click", function () {
    removeItem().catch(function (ex) { busy(false); fail($("#editError"), ex); });
  });
  $("#rebuildShare").addEventListener("click", function () {
    rebuildShare().catch(function (ex) { busy(false); toast(ex.message); });
  });
  $("#newLink").addEventListener("click", function () {
    hideLayer($("#menuLayer"));
    prefillSetup(C);
  });
  $("#logout").addEventListener("click", function () {
    if (SS) SS.removeItem("ff-admin");
    C = null;
    hideLayer($("#menuLayer"));
    init();
  });
  $("#addBtn").addEventListener("click", function () { if (S.repo) openEditor(null); });
  $("#menuBtn").addEventListener("click", function () { openLayer($("#menuLayer")); });

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, [data-close]");
    if (!t) return;
    var d = t.dataset;
    if (d.close !== undefined) { closeLayer(t.closest(".layer")); return; }
    if (d.edit) { openEditor(S.repo.items.filter(function (p) { return p.id === +d.edit; })[0]); return; }
    if (d.cat) {
      S.cat = SITE.categories.filter(function (c) { return c.id === d.cat; })[0];
      renderCats();
      $("#aList").innerHTML = '<p class="muted">Загружаю…</p>';
      reload().catch(function (ex) { toast(ex.message); });
      return;
    }
    if (d.move) {
      var i = +d.move, j = i + +d.dir, tmp = E.photos[i];
      E.photos[i] = E.photos[j]; E.photos[j] = tmp; E.dirty = true;
      renderPhotos();
      return;
    }
    if (d.drop) { E.photos.splice(+d.drop, 1); E.dirty = true; renderPhotos(); return; }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { var l = $(".layer.is-open"); if (l) closeLayer(l); }
  });

  init();
})();
