"""Backend test for NPS Live Quiz, run against a real Supabase project.

Usage:
    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_KEY=<publishable key> \
    ADMIN_PASSCODE=<admin passcode> \
    python3 tests/api/backend_test.py

It creates sessions titled "[Test] ...", plays them with simulated participants,
checks every rule the PRD sets for timing, scoring, duplicates and access control,
and ends the sessions afterwards. Nothing is deleted.
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
PASSCODE = os.environ["ADMIN_PASSCODE"]

RESULTS = []


def call(method, path, body=None):
    req = urllib.request.Request(
        URL + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"apikey": KEY, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def rpc(name, **args):
    return call("POST", "/rest/v1/rpc/" + name, args)


def err(res):
    return res.get("message") if isinstance(res, dict) else str(res)


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def wait_until(iso_ts, server_offset, extra=0.0):
    """Sleep until a server timestamp (ISO) has passed, using the measured clock offset."""
    from datetime import datetime
    target = datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).timestamp()
    delay = target - (time.time() + server_offset) + extra
    if delay > 0:
        time.sleep(delay)


def server_offset():
    from datetime import datetime
    best = None
    for _ in range(3):
        t0 = time.time()
        _, ts = rpc("get_server_time")
        t1 = time.time()
        server = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        off = server - (t0 + t1) / 2
        if best is None or (t1 - t0) < best[0]:
            best = (t1 - t0, off)
    return best[1]


def main():
    off = server_offset()
    print(f"clock offset vs database: {off:+.3f}s")

    # ---- admin auth -------------------------------------------------------
    st, res = rpc("admin_login", p_passcode="definitely-wrong")
    check("wrong passcode is rejected", st == 200 and res["ok"] is False and res["error"] == "INVALID_PASSCODE", res)
    st, res = rpc("admin_login", p_passcode=PASSCODE)
    check("correct passcode signs in", st == 200 and res["ok"] is True, res)
    tok = res["token"]

    admin_fns = {
        "admin_list_sessions": {}, "admin_create_session": {"p_title": "x"},
        "admin_get_session": {"p_session_id": "00000000-0000-0000-0000-000000000000"},
        "admin_get_bank": {}, "admin_import_bank": {"p_bank": {}},
        "admin_export_results": {"p_session_id": "00000000-0000-0000-0000-000000000000"},
        "admin_start_chapter": {"p_session_id": "00000000-0000-0000-0000-000000000000", "p_chapter_id": "ch1"},
        "admin_next_question": {"p_session_id": "00000000-0000-0000-0000-000000000000"},
        "admin_reveal": {"p_session_id": "00000000-0000-0000-0000-000000000000"},
        "admin_end_session": {"p_session_id": "00000000-0000-0000-0000-000000000000"},
    }
    denied = all(err(rpc(fn, p_admin_token="forged-token-0000000000000000000000", **a)[1]) == "ADMIN_AUTH_REQUIRED"
                 for fn, a in admin_fns.items())
    check("every admin function refuses a forged token", denied)

    # ---- direct table access with the public key ------------------------------
    st, _ = call("GET", "/rest/v1/answers?select=*")
    check("answers table is not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/session_questions?select=correct_option_id")
    check("answer keys are not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/bank_questions?select=correct_option_id")
    check("question bank is not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/participants?select=token_hash")
    check("participant tokens are not readable", st in (401, 403), st)
    st, _ = call("POST", "/rest/v1/answers", {"points_awarded": 1000})
    check("answers cannot be inserted directly", st in (401, 403), st)
    st, rows = call("GET", "/rest/v1/sessions?select=id,phase&limit=1")
    check("sessions are readable (needed for live updates)", st == 200, st)
    st, _ = call("PATCH", "/rest/v1/sessions?id=not.is.null", {"phase": "ended"})
    check("sessions cannot be changed directly", st in (401, 403), st)

    # ---- session with short timers ---------------------------------------
    settings = {"durationOverride": 6, "leadInMs": 1500, "graceMs": 500, "scoringMode": "linear",
                "feedbackMode": "on_reveal"}
    st, s = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] backend flow", p_settings=settings)
    check("session is created", st == 200 and len(s["code"]) == 6, s)
    sid, code = s["sessionId"], s["code"]

    st, r = rpc("resolve_session", p_code=code.lower())
    check("join code is case-insensitive", st == 200 and r["sessionId"] == sid, r)
    st, r = rpc("resolve_session")
    check("code-less join link finds the newest open session", st == 200 and r["sessionId"] == sid, r)

    # ---- registration ------------------------------------------------------
    st, r = rpc("join_session", p_code=code, p_display_name="   ")
    check("whitespace-only name is rejected", err(r) == "NAME_REQUIRED", r)
    st, r = rpc("join_session", p_code=code, p_display_name="x" * 31)
    check("name over 30 characters is rejected", err(r) == "NAME_TOO_LONG", r)
    people = {}
    for name in ["Alice", "Bob", "  Carol    Smith  ", "Dana"]:
        st, r = rpc("join_session", p_code=code, p_display_name=name)
        people[r["displayName"]] = r["token"]
    check("names are trimmed and collapsed", "Carol Smith" in people, list(people))
    st, r = rpc("join_session", p_code=code, p_display_name="ALICE")
    check("duplicate name (any case) is rejected", err(r) == "NAME_TAKEN", r)
    A, B, C, D = people["Alice"], people["Bob"], people["Carol Smith"], people["Dana"]

    st, ps = rpc("get_participant_state", p_token=A)
    check("participant sees four locked chapters", st == 200 and [c["status"] for c in ps["chapters"]] == ["locked"] * 4, ps)
    check("participant cannot see a question before launch", ps["question"] is None)
    st, r = rpc("submit_answer", p_token=A, p_question_id="ch1-q1", p_option_id="B")
    check("answer before launch is rejected", err(r) == "QUESTION_CLOSED", r)

    # ---- chapter 1, question 1 ---------------------------------------------
    rpc("admin_start_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id="ch1")
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    check("question launches with a lead-in", st == 200 and q["questionId"] == "ch1-q1", q)
    st, r = rpc("submit_answer", p_token=A, p_question_id="ch1-q1", p_option_id="B")
    check("answer during the lead-in is rejected", err(r) == "QUESTION_NOT_STARTED", r)

    st, ps = rpc("get_participant_state", p_token=B)
    check("participant gets the question text and options",
          ps["question"]["text"] and len(ps["question"]["options"]) == 4 and ps["question"]["correctOptionId"] is None, ps["question"])

    wait_until(q["startedAt"], off, 0.25)
    st, ra = rpc("submit_answer", p_token=A, p_question_id="ch1-q1", p_option_id="B")   # correct, fast
    st, rb = rpc("submit_answer", p_token=B, p_question_id="ch1-q1", p_option_id="A")   # wrong
    check("answer is accepted", ra.get("accepted") is True, ra)
    check("correctness is hidden until the reveal", ra.get("isCorrect") is None and ra.get("points") is None, ra)
    st, again = rpc("submit_answer", p_token=A, p_question_id="ch1-q1", p_option_id="C")
    check("second answer to the same question is refused", again.get("accepted") is False and again.get("reason") == "ALREADY_ANSWERED", again)
    time.sleep(2.0)
    st, rc = rpc("submit_answer", p_token=C, p_question_id="ch1-q1", p_option_id="B")   # correct, slower

    st, scr = rpc("get_screen_state", p_code=code)
    check("big screen shows answered count, no answer key, no leaderboard",
          scr["question"]["answeredCount"] == 3 and scr["reveal"] is None and scr["leaderboard"] is None, scr)
    st, adm = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    live = adm["live"]
    check("presenter sees live distribution and counts",
          live["answered"] == 3 and live["distribution"]["B"] == 2 and live["distribution"]["A"] == 1 and live["notAnswered"] == 1, live)
    st, ps = rpc("get_participant_state", p_token=A)
    check("score is not exposed while the question is open", ps["standing"] is None, ps["standing"])

    wait_until(q["deadline"], off, 0.8)
    st, rd = rpc("submit_answer", p_token=D, p_question_id="ch1-q1", p_option_id="B")
    check("late answer after deadline + grace is rejected", err(rd) == "DEADLINE_PASSED", rd)

    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    st, pa = rpc("get_participant_state", p_token=A)
    st, pd = rpc("get_participant_state", p_token=D)
    check("reveal shows the correct answer and points",
          pa["question"]["correctOptionId"] == "B" and pa["question"]["myAnswer"]["isCorrect"] is True and pa["question"]["myAnswer"]["points"] > 0,
          pa["question"])
    check("no answer is recorded as timed out with 0 points",
          pd["question"]["myAnswer"]["status"] == "timed_out" and pd["question"]["myAnswer"]["points"] == 0, pd["question"])
    a_pts = pa["question"]["myAnswer"]["points"]
    a_rt = pa["question"]["myAnswer"]["responseTimeMs"]
    expected = round(1000 * (6000 - a_rt) / 6000)
    check("points follow round(1000 x remaining / total)", abs(a_pts - expected) <= 1, f"points={a_pts} rt={a_rt} expected={expected}")
    st, pc = rpc("get_participant_state", p_token=C)
    check("faster correct answer earns more points", pc["question"]["myAnswer"]["points"] < a_pts,
          f"{pc['question']['myAnswer']['points']} vs {a_pts}")
    st, pb = rpc("get_participant_state", p_token=B)
    check("wrong answer earns 0 points", pb["question"]["myAnswer"]["points"] == 0 and pb["question"]["myAnswer"]["isCorrect"] is False)

    st, scr = rpc("get_screen_state", p_code=code)
    order = [row["displayName"] for row in scr["leaderboard"]]
    check("leaderboard order: points, then correct answers, then response time",
          order[:2] == ["Alice", "Carol Smith"] and order[2:] == ["Bob", "Dana"], order)
    check("big screen gets distribution after reveal", scr["reveal"]["distribution"] == {"A": 1, "B": 2, "C": 0, "D": 0}, scr["reveal"])

    # ---- concurrency: everyone answers at once, plus a double submit --------
    extra = []
    for i in range(12):
        st, r = rpc("join_session", p_code=code, p_display_name=f"Load {i:02d}")
        extra.append(r["token"])
    st, q2 = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    wait_until(q2["startedAt"], off, 0.2)
    jobs = [(t, "A") for t in extra] + [(A, "A"), (A, "B"), (B, "C"), (C, "D")]
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        outs = list(ex.map(lambda j: rpc("submit_answer", p_token=j[0], p_question_id="ch1-q2", p_option_id=j[1])[1], jobs))
    accepted = sum(1 for o in outs if isinstance(o, dict) and o.get("accepted") is True)
    alice = [o for (t, _), o in zip(jobs, outs) if t == A]
    check("16 simultaneous submissions: 15 accepted, Alice's double submit counted once",
          accepted == 15 and sum(1 for o in alice if o.get("accepted")) == 1, [o.get("reason", o.get("accepted")) for o in outs])

    # ---- pause and resume ----------------------------------------------------
    rpc("admin_pause", p_admin_token=tok, p_session_id=sid)
    st, r = rpc("submit_answer", p_token=D, p_question_id="ch1-q2", p_option_id="D")
    check("answers are refused while paused", err(r) == "QUESTION_PAUSED", r)
    time.sleep(1.5)
    rpc("admin_resume", p_admin_token=tok, p_session_id=sid)
    st, adm = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    check("resume moves the deadline forward", adm["question"]["deadline"] > q2["deadline"], (adm["question"]["deadline"], q2["deadline"]))
    st, r = rpc("submit_answer", p_token=D, p_question_id="ch1-q2", p_option_id="D")
    check("answers are accepted again after resume", r.get("accepted") is True, r)
    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)

    # ---- finish chapter 1 ------------------------------------------------------
    st, r = rpc("admin_finish_chapter", p_admin_token=tok, p_session_id=sid)
    check("chapter cannot finish with unplayed questions", err(r) == "CHAPTER_NOT_FINISHED", r)
    for _ in range(3):
        st, qn = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
        wait_until(qn["startedAt"], off, 0.2)
        for t in (A, B, C, D):
            rpc("submit_answer", p_token=t, p_question_id=qn["questionId"], p_option_id="A")
        rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    st, r = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    check("no sixth question in a chapter", err(r) == "NO_MORE_QUESTIONS", r)
    rpc("admin_finish_chapter", p_admin_token=tok, p_session_id=sid)
    st, pa = rpc("get_participant_state", p_token=A)
    ch1 = pa["chapters"][0]
    check("chapter results: status completed, 5 questions seen", ch1["status"] == "completed" and ch1["stats"]["seen"] == 5, ch1)
    check("standing has rank and totals", pa["standing"]["rank"] >= 1 and pa["standing"]["chaptersCompleted"] == 1, pa["standing"])

    # ---- exports ---------------------------------------------------------------
    st, ex = rpc("admin_export_results", p_admin_token=tok, p_session_id=sid)
    alice_row = next(r for r in ex["rows"] if r["displayName"] == "Alice")
    check("results export has per-chapter points and totals",
          alice_row["chapterPoints"]["ch1"] == alice_row["totalPoints"] and alice_row["completionStatus"] == "in_progress", alice_row)
    st, ia = rpc("admin_export_item_analysis", p_admin_token=tok, p_session_id=sid)
    q1 = next(r for r in ia if r["questionId"] == "ch1-q1")
    check("item analysis counts answers per option", q1["optionB"] == 2 and q1["timedOut"] >= 1, q1)

    # ---- reset, removal, registration -------------------------------------------
    st, r = rpc("admin_reset_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id="ch1", p_confirm="yes")
    check("reset needs the typed confirmation", err(r) == "CONFIRMATION_REQUIRED", r)
    st, r = rpc("admin_reset_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id="ch1", p_confirm="RESET")
    check("chapter reset voids its answers", st == 200 and r["voidedAnswers"] > 0, r)
    st, pa = rpc("get_participant_state", p_token=A)
    check("after reset the chapter is locked and the score is 0",
          pa["chapters"][0]["status"] == "locked" and pa["standing"]["totalPoints"] == 0, (pa["chapters"][0], pa["standing"]))

    alice_id = pa["participant"]["id"]
    rpc("admin_remove_participant", p_admin_token=tok, p_participant_id=alice_id)
    st, r = rpc("get_participant_state", p_token=A)
    check("removed participant is signed out", err(r) == "PARTICIPANT_REMOVED", r)
    st, r = rpc("join_session", p_code=code, p_display_name="Alice")
    check("a removed participant's name can be used again", st == 200, r)

    rpc("admin_set_registration", p_admin_token=tok, p_session_id=sid, p_open=False)
    st, r = rpc("join_session", p_code=code, p_display_name="Late Larry")
    check("closed registration refuses new joins", err(r) == "REGISTRATION_CLOSED", r)

    rpc("admin_end_session", p_admin_token=tok, p_session_id=sid)
    st, r = rpc("join_session", p_code=code, p_display_name="After End")
    check("ended session refuses joins", err(r) == "SESSION_ENDED", r)
    st, ps = rpc("get_participant_state", p_token=B)
    check("participants see the ended state", ps["session"]["phase"] == "ended", ps["session"])

    # ---- alternative modes ---------------------------------------------------------
    st, s2 = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] modes",
                 p_settings={"durationOverride": 5, "leadInMs": 0, "graceMs": 300,
                             "scoringMode": "half_floor", "feedbackMode": "immediate"})
    st, j = rpc("join_session", p_code=s2["code"], p_display_name="Slow Sam")
    rpc("admin_start_chapter", p_admin_token=tok, p_session_id=s2["sessionId"], p_chapter_id="ch2")
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=s2["sessionId"])
    time.sleep(4.2)
    st, r = rpc("submit_answer", p_token=j["token"], p_question_id="ch2-q1", p_option_id="C")
    check("immediate feedback mode returns correctness at once", r.get("isCorrect") is True, r)
    check("half-floor scoring keeps a late correct answer at 500+", r.get("points", 0) >= 500, r)
    rpc("admin_end_session", p_admin_token=tok, p_session_id=s2["sessionId"])

    # ---- bank validation ------------------------------------------------------------
    st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank={"chapters": [{"id": "x"}]})
    check("invalid question bank is rejected", err(r).startswith("BANK_INVALID"), r)

    rpc("admin_logout", p_admin_token=tok)
    st, r = rpc("admin_list_sessions", p_admin_token=tok)
    check("logout invalidates the admin token", err(r) == "ADMIN_AUTH_REQUIRED", r)

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
