#!/usr/bin/env python3
"""
Страницы для поиска и мессенджеров — то же, что кнопка «Обновить превью-ссылки»
в админке, только для всех разделов сразу, плюс sitemap.xml и robots.txt.

Запуск из корня проекта:
    python3 tools/make-share-pages.py https://адрес-сайта/            — все разделы
    python3 tools/make-share-pages.py https://адрес-сайта/ bedrooms   — только спальни

Что создаётся:
  <раздел>/index.html          — страница раздела (Google видит «Кухни в Чеченской Республике…»)
  <раздел>/<номер>/index.html  — страница модели (карточка в WhatsApp/Telegram и в поиске)
  sitemap.xml, robots.txt      — карта сайта для поисковиков

Каждая страница — это копия index.html со своими заголовком, описанием, og-тегами и
адресом (canonical). Сайт открывается сразу на нужном разделе или модели (window.FF_START).
Эти файлы нужно загрузить в корень репозитория.
"""
import datetime
import html
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def site_config():
    text = read("data/config.js")
    brand = re.search(r'brand:\s*"([^"]+)"', text).group(1)
    # Разделы — только незакомментированные строки
    live = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))
    cats = []
    for m in re.finditer(r'\bid:\s*"([\w-]+)"', live):
        chunk = live[m.end():m.end() + 900]
        get = lambda k: (re.search(k + r':\s*"([^"]*)"', chunk) or [None, ""])[1]
        cats.append({"id": m.group(1), "title": get("title"), "one": get("one"), "lead": get("lead"),
                     "byType": bool(re.search(r"nameByType:\s*true", live[m.end():].split("\n    }")[0]))})
    return brand, [c for c in cats if c["title"]]


def items_of(cat_id):
    path = os.path.join(ROOT, "data", cat_id + ".js")
    if not os.path.exists(path):
        return []
    text = read("data/" + cat_id + ".js")
    marker = "window.CATALOG.%s = [" % cat_id
    body = text[text.index(marker) + len(marker):text.rindex("];")].strip().rstrip(",")
    return json.loads("[" + body + "]")


def plural(n, forms):
    n = abs(n) % 100
    if 11 <= n <= 14:
        return forms[2]
    n %= 10
    return forms[0] if n == 1 else forms[1] if 2 <= n <= 4 else forms[2]


def page(tpl, base, path, title, desc, image, start):
    """Копия index.html со своими мета-тегами. Та же логика — в admin.js (pageFromTemplate)."""
    e = lambda s: html.escape(str(s), quote=True)
    url = base + path
    t = tpl
    # Убираем общие для главной теги, которые заменяем своими
    t = re.sub(r'\s*<(?:base|link rel="canonical"|meta property="og:url"|meta property="og:image"|meta name="twitter:card")[^>]*>', "", t)
    t = re.sub(r"<title>[^<]*</title>", lambda m: "<title>%s</title>" % e(title), t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', lambda m: '<meta name="description" content="%s">' % e(desc), t, count=1)
    t = re.sub(r'<meta property="og:title" content="[^"]*">', lambda m: '<meta property="og:title" content="%s">' % e(title), t, count=1)
    t = re.sub(r'<meta property="og:description" content="[^"]*">', lambda m: '<meta property="og:description" content="%s">' % e(desc), t, count=1)
    head = "\n".join([
        '<base href="%s">' % e(base),
        '<link rel="canonical" href="%s">' % e(url),
        '<meta property="og:url" content="%s">' % e(url),
        '<meta property="og:image" content="%s">' % e(image),
        '<meta name="twitter:card" content="summary_large_image">',
    ])
    t = t.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + head, 1)
    start_js = "<script>window.FF_START=%s;</script>\n" % json.dumps(start, ensure_ascii=False, separators=(",", ":"))
    t = t.replace('<script src="data/config.js"></script>', start_js + '<script src="data/config.js"></script>', 1)
    return t


def main():
    if len(sys.argv) < 2 or not re.match(r"^https?://[^/]+", sys.argv[1]):
        sys.exit("Укажите адрес сайта: python3 tools/make-share-pages.py https://адрес-сайта/")
    base = sys.argv[1].strip().rstrip("/") + "/"
    brand, cats = site_config()
    tpl = read("index.html")
    version = format(int(time.time() * 1000), "x")
    only = set(sys.argv[2:])
    today = datetime.date.today().isoformat()
    urls = [base]
    for cat in cats:
        cid, items = cat["id"], items_of(cat["id"])
        urls.append(base + cid + "/")
        urls += [base + "%s/%s/" % (cid, p["id"]) for p in items]
        if only and cid not in only:
            continue
        # Страница раздела
        n = len(items)
        title = "%s в Чеченской Республике — %d %s, доставка по России | %s" % (cat["title"], n, plural(n, ["модель", "модели", "моделей"]), brand)
        cover = "%sphotos/%s/thumbs/%s_1.jpg?v=%s" % (base, cid, items[0]["id"], version) if items else base + "assets/img/apple-touch-icon.jpg"
        out = os.path.join(ROOT, cid, "index.html")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(page(tpl, base, cid + "/", title, cat["lead"] + " Мебельный магазин в Чеченской Республике, доставка по всей России.", cover, {"cat": cid}))
        # Страницы моделей
        for p in items:
            one = "банкетка" if p.get("type") == "Банкетка" else (p["type"].split(" / ")[0].lower() if cat["byType"] and p.get("type") else cat["one"])
            nn = p["name"].lower().replace("ё", "е"); o = one.lower().replace("ё", "е")
            generic = nn == o or nn == p.get("type", "").lower().replace("ё", "е") or nn.startswith(o + " ")
            name = "%s%s · № %s" % (one[:1].upper() + one[1:], p["name"][len(one):] if generic else " «%s»" % p["name"], p["id"])
            facts = [p["type"], " / ".join(p["sizes"]) + (" см" if all(re.match(r"^[Ø\d\s.,×–-]+$", s) for s in p["sizes"]) else "") if p["sizes"] else "", ", ".join(p["colors"]), p["producer"]]
            desc = " · ".join(x for x in facts if x) + ". Мебель в Чеченской Республике с доставкой по России — %s." % brand
            img = "%sphotos/%s/thumbs/%s_1.jpg?v=%s" % (base, cid, p["id"], version)
            out = os.path.join(ROOT, cid, str(p["id"]), "index.html")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w", encoding="utf-8") as f:
                f.write(page(tpl, base, "%s/%s/" % (cid, p["id"]), name + " — " + brand, desc, img, {"cat": cid, "id": p["id"]}))
        print("%s: раздел + %d %s (адрес %s%s/…)" % (cid, n, plural(n, ["модель", "модели", "моделей"]), base, cid))

    # Карта сайта и robots.txt
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in urls:
            f.write("  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (html.escape(u), today))
        f.write("</urlset>\n")
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as f:
        f.write("User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /tools/\n\nSitemap: %ssitemap.xml\n" % base)
    print("sitemap.xml: %d адресов, robots.txt" % len(urls))


if __name__ == "__main__":
    main()
