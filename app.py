"""Profile Card Generator – Flask backend.

POST /api/profiles          create a profile  -> {profile, analytics, card_html}
POST /api/preview           validate + analyse without saving (live preview)
PUT  /api/profiles/<id>     update a profile
GET  /api/profiles          list profiles (with scores)
GET  /api/profiles/<id>     one profile + analytics + card_html
DELETE /api/profiles/<id>   delete
GET  /api/analytics         aggregate analytics across all profiles
POST /api/seed              load sample profiles
"""
import json
import os
import re
import tempfile
import threading
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, render_template, request

BASE = Path(__file__).parent
DATA_FILE = Path(os.environ.get("PROFILE_DATA", BASE / "data" / "profiles.json"))
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024  # profile payloads are tiny
_lock = threading.Lock()

THEMES = ["ocean", "sunset", "mint", "lavender", "slate"]
LIMITS = {"name": 80, "title": 120, "location": 80, "bio": 600, "image_url": 500,
          "website": 200, "email": 120}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STOP = set("""a an the and or but if of to in on at for with from by is are was were be been it its this
that as i my me we our you your they their he she his her not have has had do does did can will just so
than then also more most very about into over out up all any who which when where what how i'm i've""".split())


# --------------------------------------------------------------------------- storage
def _load():
    try:
        return json.loads(DATA_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save(items):
    fd, tmp = tempfile.mkstemp(dir=DATA_FILE.parent, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(items, f, indent=2)
    os.replace(tmp, DATA_FILE)


# --------------------------------------------------------------------------- validation
def _payload():
    data = request.get_json(silent=True)
    if data is None:
        data = request.form.to_dict()
    return data if isinstance(data, dict) else {}


def _http_url(value, field, errors, add_scheme=False):
    value = (value or "").strip()
    if not value:
        return ""
    if add_scheme and not re.match(r"^[a-z][a-z0-9+.-]*://", value, re.I):
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or " " in value:
        errors[field] = "Enter a valid http(s) URL."
        return ""
    return value


def clean(data, require_name=True):
    """Return (profile_fields, errors)."""
    errors = {}
    s = lambda k: str(data.get(k) or "").strip()
    p = {k: s(k) for k in ("name", "title", "location", "bio", "email")}
    for k, limit in LIMITS.items():
        if k in p and len(p[k]) > limit:
            errors[k] = f"Keep this under {limit} characters."
    if require_name and len(p["name"]) < 2:
        errors["name"] = "Name is required (at least 2 characters)."
    if p["email"] and not EMAIL_RE.match(p["email"]):
        errors["email"] = "Enter a valid email address."
    p["image_url"] = _http_url(data.get("image_url"), "image_url", errors)
    p["website"] = _http_url(data.get("website"), "website", errors, add_scheme=True)
    for k in ("image_url", "website"):
        if len(p[k]) > LIMITS[k]:
            errors[k] = f"Keep this under {LIMITS[k]} characters."

    raw = data.get("skills") or []
    if isinstance(raw, str):
        raw = re.split(r"[,\n]", raw)
    skills, seen = [], set()
    for item in raw:
        item = str(item).strip()
        if item and item.lower() not in seen:
            seen.add(item.lower())
            skills.append(item)
    if any(len(x) > 30 for x in skills):
        errors["skills"] = "Each skill must be under 30 characters."
    if len(skills) > 12:
        errors["skills"] = "Add at most 12 skills."
    p["skills"] = skills[:12]
    theme = s("theme").lower()
    p["theme"] = theme if theme in THEMES else "ocean"
    return p, errors


# --------------------------------------------------------------------------- analytics
def analyze(p):
    bio = p.get("bio", "")
    words = re.findall(r"[\w'’+#-]+", bio)
    sentences = [x for x in re.split(r"[.!?]+\s*", bio) if x.strip()]
    avg_sentence = round(len(words) / len(sentences), 1) if sentences else 0
    readability = ("—" if not words else "Easy" if avg_sentence <= 14
                   else "Balanced" if avg_sentence <= 22 else "Dense")
    kw = Counter(w.lower().strip("-'’") for w in words
                 if len(w) > 3 and w.lower() not in STOP and not w.isdigit())
    n_sk = len(p.get("skills", []))
    tlen = len(p.get("title", ""))
    nlen = len(p.get("name", ""))

    parts = [
        ("Name", 10 if " " in p.get("name", "").strip() else (6 if nlen >= 2 else 0), 10,
         "Use your full name (first and last)."),
        ("Headline", 15 if tlen >= 15 else (8 if tlen else 0), 15,
         "Write a headline of 15+ characters that states your role and value."),
        ("Photo", 15 if p.get("image_url") else 0, 15, "Add a professional photo URL."),
        ("Bio", round(25 * min(1, len(words) / 40)), 25,
         "Write a bio of at least 40 words about your experience and goals."),
        ("Skills", min(15, 3 * n_sk), 15, "Add 5 or more relevant skills."),
        ("Website", 10 if p.get("website") else 0, 10, "Link your portfolio or website."),
        ("Location", 5 if p.get("location") else 0, 5, "Add your location."),
        ("Contact", 5 if p.get("email") else 0, 5, "Add a contact email."),
    ]
    score = sum(x[1] for x in parts)
    grade = ("Getting started" if score < 40 else "Good" if score < 70
             else "Strong" if score < 90 else "All-star")
    return {
        "score": score,
        "grade": grade,
        "breakdown": [{"label": l, "earned": e, "max": m, "done": e >= m} for l, e, m, _ in parts],
        "suggestions": [t for _, e, m, t in parts if e < m],
        "bio": {"words": len(words), "characters": len(bio), "sentences": len(sentences),
                "reading_seconds": round(len(words) / 200 * 60), "avg_sentence": avg_sentence,
                "readability": readability},
        "headline_length": tlen,
        "skills_count": n_sk,
        "keywords": [{"word": w, "count": c} for w, c in kw.most_common(6)],
    }


def aggregate(items):
    scored = [(p, analyze(p)["score"]) for p in items]
    n = len(items)
    buckets = [("0–39", 0, 39), ("40–69", 40, 69), ("70–89", 70, 89), ("90–100", 90, 100)]
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]
    per_day = Counter(p["created_at"][:10] for p in items)
    skills = Counter(s.title() if s.islower() else s for p in items for s in p.get("skills", []))
    return {
        "total": n,
        "avg_score": round(sum(s for _, s in scored) / n) if n else 0,
        "with_photo": sum(1 for p in items if p.get("image_url")),
        "avg_bio_words": round(sum(analyze(p)["bio"]["words"] for p in items) / n) if n else 0,
        "complete": sum(1 for _, s in scored if s >= 90),
        "distribution": [{"label": l, "count": sum(1 for _, s in scored if lo <= s <= hi)}
                         for l, lo, hi in buckets],
        "last7": [{"label": d.strftime("%a"), "count": per_day.get(d.isoformat(), 0)} for d in days],
        "top_skills": [{"skill": k, "count": v} for k, v in skills.most_common(6)],
        "recent": [summary(p) for p in sorted(items, key=lambda x: x["created_at"], reverse=True)[:5]],
    }


def summary(p):
    return {**p, "score": analyze(p)["score"]}


def initials(name):
    words = [re.sub(r"[^\w]", "", w) for w in name.split()]
    return "".join(w[0] for w in words if w)[:2].upper() or "?"


def full(p):
    return {"profile": p, "analytics": analyze(p),
            "card_html": render_template("_card.html", p=p, initials=initials(p["name"]))}


# --------------------------------------------------------------------------- routes
@app.get("/")
def index():
    return render_template("index.html", themes=THEMES)


@app.post("/api/preview")
def preview():
    p, _ = clean(_payload(), require_name=False)
    p.update(id="preview", name=p["name"] or "Your Name")
    return jsonify(full(p))


@app.post("/api/profiles")
def create():
    p, errors = clean(_payload())
    if errors:
        return jsonify({"errors": errors}), 422
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    p.update(id=uuid.uuid4().hex[:10], created_at=now, updated_at=now)
    with _lock:
        items = _load()
        items.append(p)
        _save(items)
    return jsonify(full(p)), 201


@app.put("/api/profiles/<pid>")
def update(pid):
    p, errors = clean(_payload())
    if errors:
        return jsonify({"errors": errors}), 422
    with _lock:
        items = _load()
        for i, old in enumerate(items):
            if old["id"] == pid:
                p.update(id=pid, created_at=old["created_at"],
                         updated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
                items[i] = p
                _save(items)
                return jsonify(full(p))
    return jsonify({"error": "Profile not found"}), 404


@app.get("/api/profiles")
def list_profiles():
    items = sorted(_load(), key=lambda x: x["created_at"], reverse=True)
    return jsonify([summary(p) for p in items])


@app.get("/api/profiles/<pid>")
def get_profile(pid):
    for p in _load():
        if p["id"] == pid:
            return jsonify(full(p))
    return jsonify({"error": "Profile not found"}), 404


@app.delete("/api/profiles/<pid>")
def delete(pid):
    with _lock:
        items = _load()
        kept = [p for p in items if p["id"] != pid]
        if len(kept) == len(items):
            return jsonify({"error": "Profile not found"}), 404
        _save(kept)
    return jsonify({"deleted": pid})


@app.get("/api/analytics")
def analytics():
    return jsonify(aggregate(_load()))


SAMPLES = [
    dict(name="Lorna Alvarado", title="Marketing Manager at Arowwai Industries", location="Barcelona, Spain",
         bio="Marketing leader with eight years of experience growing B2B brands. I turn customer research into campaigns that "
             "convert. Previously led a team of twelve across content, paid and lifecycle. Passionate about data-driven storytelling "
             "and mentoring early-career marketers.",
         website="lorna.example.com", email="lorna@example.com", theme="ocean",
         skills="Brand Strategy, SEO, Analytics, Content, Leadership, HubSpot"),
    dict(name="Arjun Mehta", title="Senior Software Engineer", location="Bengaluru, India",
         bio="Backend engineer who enjoys building reliable APIs.", theme="lavender", skills="Python, Flask, PostgreSQL"),
    dict(name="Priya Nair", title="Product Designer focused on fintech and accessibility", location="Mumbai, India",
         bio="Designer shipping calm, accessible interfaces for money tools. I run research sprints, prototype quickly and work "
             "closely with engineers to ship polished work. Currently exploring design systems that scale across products.",
         website="https://priya.example.com", theme="sunset", skills="Figma, Research, Design Systems, Prototyping, WCAG"),
]


@app.post("/api/seed")
def seed():
    with _lock:
        items = _load()
        now = datetime.now(timezone.utc)
        for i, s in enumerate(SAMPLES):
            p, _ = clean(s)
            ts = (now - timedelta(days=i * 2)).isoformat(timespec="seconds")
            p.update(id=uuid.uuid4().hex[:10], created_at=ts, updated_at=ts)
            items.append(p)
        _save(items)
    return jsonify({"added": len(SAMPLES)}), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=bool(os.environ.get("DEBUG")))
