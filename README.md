
# Profile Card Generator

Flask app: a form POSTs profile details to the backend, which validates them, scores the profile
and returns a rendered profile card plus analytics.

    pip install flask
    python app.py          # http://localhost:5000  (PORT env var to change)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/profiles | Create (JSON or form-encoded) -> `{profile, analytics, card_html}`; 422 + `errors` if invalid |
| POST | /api/preview | Same, without saving (powers the live preview) |
| PUT / DELETE | /api/profiles/<id> | Update / delete |
| GET | /api/profiles, /api/profiles/<id> | List / fetch with analytics |
| GET | /api/analytics | Aggregate stats across all profiles |
| POST | /api/seed | Load 3 sample profiles |

Data is stored in `data/profiles.json`. Image URLs are never fetched server-side (http/https only).

# Profile-card-genarator-Task2
A form-based profile card generator built with Node.js and Express. Users submit their name, bio and image URL through a POST request, and the server returns a formatted profile card. It also scores each profile with analytics such as completeness, strength and bio readability, all in a clean light-mode UI.