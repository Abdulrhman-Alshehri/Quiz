"""Upgrade check: a session that started before the newest migration carries on after it.

Run through upgrade-check.sh, which builds a database with every migration except the
newest, serves it on its own port, and passes these settings:

    API        Data API stand-in for that database (http://localhost:54331)
    DB_URL     the database itself, for applying the migration and reading tables
    MIGRATION  the migration file to apply while the session is open
    ADMIN_PASSCODE

A session plays the first question of the first chapter with the old database
functions, the migration is applied while the session waits on the reveal, then the
same session plays the next question (one phone with the old call shape, one with the
new) and the results, question analysis and screens are checked.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("API", "http://localhost:54331")
DB = os.environ["DB_URL"]
MIGRATION = os.environ["MIGRATION"]
PASSCODE = os.environ.get("ADMIN_PASSCODE", "local-dev-passcode")
KEY = "local-dev-publishable-key-000000"
QUIET = {**os.environ, "PGOPTIONS": "-c client_min_messages=error"}
RESULTS = []


def rpc(fn, **args):
    req = urllib.request.Request(f"{API}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
                                 headers={"apikey": KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    RESULTS.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))


def sql(query):
    return subprocess.run(["psql", DB, "-Atc", query], capture_output=True, text=True, check=True, env=QUIET).stdout.strip()


tok = rpc("admin_login", p_passcode=PASSCODE)["token"]
bank = rpc("admin_get_bank", p_admin_token=tok)
chapter = bank["chapters"][0]
q1, q2 = chapter["questions"][0], chapter["questions"][1]
right1, right2 = q1["correctOptionId"], q2["correctOptionId"]
wrong1 = next(o["id"] for o in q1["options"] if o["id"] != right1)

s = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] upgrade",
        p_settings={"leadInMs": 0, "graceMs": 500, "durationOverride": 20, "feedbackMode": "immediate"})
sid, code = s["sessionId"], s["code"]
old_phone = rpc("join_session", p_code=code, p_display_name="Old page")["token"]
new_phone = rpc("join_session", p_code=code, p_display_name="New page")["token"]
rpc("admin_start_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id=chapter["id"])
rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
time.sleep(0.5)
a1 = rpc("submit_answer", p_token=old_phone, p_question_id=q1["id"], p_option_id=right1)
a2 = rpc("submit_answer", p_token=new_phone, p_question_id=q1["id"], p_option_id=wrong1)
check("before: the old database scores the first question", a1.get("isCorrect") is True and a2.get("isCorrect") is False, (a1, a2))
points_before = a1.get("points", 0)
rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)

# ---- the migration, applied while the session waits on the reveal ----------------
started = time.time()
out = subprocess.run(["psql", DB, "-q", "-v", "ON_ERROR_STOP=1", "-f", MIGRATION], capture_output=True, text=True, env=QUIET)
check("the migration applies with a session open", out.returncode == 0, out.stderr[-400:])
print(f"   ({os.path.basename(MIGRATION)} took {time.time() - started:.1f}s)")
n = sql(f"select count(*) from public.session_questions where session_id = '{sid}'")
snap = sql(f"select count(*) from public.session_questions where session_id = '{sid}' "
           f"and question_type = 'single' and correct_option_ids = array[correct_option_id]")
check("the open session's questions became single choice with their right answers", snap == n, f"{snap} of {n}")
kept = sql(f"select string_agg(array_to_string(selected_option_ids, ','), ' ' order by submitted_at) "
           f"from public.answers where session_id = '{sid}'")
check("answers given before the migration were kept", kept == f"{right1} {wrong1}", kept)

# ---- the same session carries on -------------------------------------------------
state = rpc("get_participant_state", p_token=old_phone)
check("a phone's state still loads", state and state.get("session", {}).get("code") == code, str(state)[:200])
nxt = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
check("the next question launches", nxt and nxt.get("questionId") == q2["id"], nxt)
time.sleep(0.5)
b1 = rpc("submit_answer", p_token=old_phone, p_question_id=q2["id"], p_option_id=right2)       # a page loaded before the update
b2 = rpc("submit_answer", p_token=new_phone, p_question_id=q2["id"], p_option_ids=[right2])    # the new page
check("an answer from the old page (one option) is accepted and scored", b1.get("accepted") is True and b1.get("isCorrect") is True, b1)
check("an answer from the new page (a list) is accepted and scored", b2.get("accepted") is True and b2.get("isCorrect") is True, b2)
rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
rows = {r["displayName"]: r for r in rpc("admin_export_results", p_admin_token=tok, p_session_id=sid)["rows"]}
old, new = rows.get("Old page", {}), rows.get("New page", {})
check("results: the old page has 2 right, the new page 1", old.get("correct") == 2 and new.get("correct") == 1, (old, new))
check("points from before the migration still count",
      old.get("totalPoints", 0) >= points_before > 0 and old.get("totalPoints", 0) > new.get("totalPoints", 0), (old, new))
analysis = {r["questionId"]: r for r in rpc("admin_export_item_analysis", p_admin_token=tok, p_session_id=sid)}
first = analysis.get(q1["id"], {})
check("question analysis counts the answers given before the migration",
      first.get(f"option{right1}") == 1 and first.get(f"option{wrong1}") == 1, first)
screen = rpc("get_screen_state", p_code=code)
check("the big screen state loads", screen is not None and "session" in screen, str(screen)[:200])
rpc("admin_end_session", p_admin_token=tok, p_session_id=sid)

print(f"\n{sum(RESULTS)}/{len(RESULTS)} checks passed")
sys.exit(0 if all(RESULTS) else 1)
