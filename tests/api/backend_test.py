"""Backend test for NPS Live Quiz, run against a Supabase project or the local test backend.

Usage:
    SUPABASE_URL=https://<ref>.supabase.co \\
    SUPABASE_KEY=<publishable key> \\
    ADMIN_PASSCODE=<admin passcode> \\
    python3 tests/api/backend_test.py

    Add ALLOW_BANK_CHANGES=1 to also test the question-bank editor and the
    question types. That part adds, edits, retires and reorders chapters and
    questions, imports test banks, and finally imports the original bank back.
    Run it only on the local test backend (tools/local-backend) or a copy of
    the project, never on the live bank before a workshop.

The rest creates sessions titled "[Test] ...", plays them with simulated
participants, checks the rules for timing, scoring, duplicates and access
control, and ends the sessions afterwards. It reads the right answers from the
question bank, so it works with any bank. Nothing is deleted.
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
BANK_CHANGES = os.environ.get("ALLOW_BANK_CHANGES") == "1"

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
    return (res.get("message") or "") if isinstance(res, dict) else str(res)


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


def right(q):
    return sorted(q.get("correctOptionIds") or [q["correctOptionId"]])


def wrong(q):
    """A one-option answer that is never right."""
    ids = [o["id"] for o in q["options"]]
    rights = right(q)
    if q.get("type") == "multiple":
        return [rights[0]]  # only part of the right set
    return [next(i for i in ids if i not in rights)]


def answer(token, qid, ids):
    return rpc("submit_answer", p_token=token, p_question_id=qid, p_option_ids=ids)


def opts(*texts):
    return [{"id": "ABCDEFG"[i], "text": t} for i, t in enumerate(texts)]


def main():
    off = server_offset()
    print(f"clock offset vs database: {off:+.3f}s")

    # ---- admin auth -------------------------------------------------------
    st, res = rpc("admin_login", p_passcode="definitely-wrong")
    check("wrong passcode is rejected", st == 200 and res["ok"] is False and res["error"] == "INVALID_PASSCODE", res)
    st, res = rpc("admin_login", p_passcode=PASSCODE)
    check("correct passcode signs in", st == 200 and res["ok"] is True, res)
    tok = res["token"]

    zero = "00000000-0000-0000-0000-000000000000"
    admin_fns = {
        "admin_list_sessions": {}, "admin_create_session": {"p_title": "x"},
        "admin_get_session": {"p_session_id": zero},
        "admin_get_bank": {}, "admin_import_bank": {"p_bank": {}},
        "admin_export_results": {"p_session_id": zero},
        "admin_start_chapter": {"p_session_id": zero, "p_chapter_id": "ch1"},
        "admin_next_question": {"p_session_id": zero},
        "admin_reveal": {"p_session_id": zero},
        "admin_end_session": {"p_session_id": zero},
        "admin_save_chapter": {"p_chapter": {"title": "x"}},
        "admin_retire_chapter": {"p_chapter_id": "ch1"},
        "admin_restore_chapter": {"p_chapter_id": "ch1"},
        "admin_reorder_chapters": {"p_chapter_ids": ["ch1"]},
        "admin_save_question": {"p_question": {"chapterId": "ch1", "text": "x"}},
        "admin_retire_question": {"p_question_id": "ch1-q1"},
        "admin_restore_question": {"p_question_id": "ch1-q1"},
        "admin_reorder_questions": {"p_chapter_id": "ch1", "p_question_ids": ["ch1-q1"]},
        "admin_question_history": {"p_question_id": "ch1-q1"},
        "admin_revert_question": {"p_question_id": "ch1-q1", "p_change_id": 1},
    }
    refused = [fn for fn, a in admin_fns.items()
               if err(rpc(fn, p_admin_token="forged-token-0000000000000000000000", **a)[1]) != "ADMIN_AUTH_REQUIRED"]
    check(f"every admin function ({len(admin_fns)}) refuses a forged token", not refused, refused)

    # ---- direct table access with the public key ------------------------------
    st, _ = call("GET", "/rest/v1/answers?select=*")
    check("answers table is not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/session_questions?select=correct_option_ids")
    check("answer keys are not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/bank_questions?select=correct_option_ids")
    check("question bank is not readable", st in (401, 403), st)
    st, _ = call("GET", "/rest/v1/participants?select=token_hash")
    check("participant tokens are not readable", st in (401, 403), st)
    st, _ = call("POST", "/rest/v1/answers", {"points_awarded": 1000})
    check("answers cannot be inserted directly", st in (401, 403), st)
    st, _ = call("POST", "/rest/v1/bank_questions", {"id": "hack", "question_text": "x"})
    check("questions cannot be inserted directly", st in (401, 403), st)
    st, rows = call("GET", "/rest/v1/sessions?select=id,phase&limit=1")
    check("sessions are readable (needed for live updates)", st == 200, st)
    st, _ = call("PATCH", "/rest/v1/sessions?id=not.is.null", {"phase": "ended"})
    check("sessions cannot be changed directly", st in (401, 403), st)

    # ---- the bank decides the answers this test gives ------------------------
    st, bank = rpc("admin_get_bank", p_admin_token=tok)
    check("presenter can read the bank", st == 200 and bank["chapters"] and bank["problem"] is None, bank.get("problem") if isinstance(bank, dict) else bank)
    chapters = bank["chapters"]
    ch1 = chapters[0]
    q1, q2 = ch1["questions"][0], ch1["questions"][1]

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
    check(f"participant sees {len(chapters)} locked chapters",
          st == 200 and [c["status"] for c in ps["chapters"]] == ["locked"] * len(chapters), ps)
    check("participant cannot see a question before launch", ps["question"] is None)
    st, r = answer(A, q1["id"], right(q1))
    check("answer before launch is rejected", err(r) == "QUESTION_CLOSED", r)

    # ---- chapter 1, question 1 ---------------------------------------------
    rpc("admin_start_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id=ch1["id"])
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    check("question launches with a lead-in", st == 200 and q["questionId"] == q1["id"], q)
    st, r = answer(A, q1["id"], right(q1))
    check("answer during the lead-in is rejected", err(r) == "QUESTION_NOT_STARTED", r)

    st, ps = rpc("get_participant_state", p_token=B)
    check("participant gets the question, its type and options, but no answer key",
          ps["question"]["text"] and ps["question"]["type"] == q1["type"]
          and len(ps["question"]["options"]) == len(q1["options"])
          and ps["question"]["correctOptionIds"] is None and ps["question"]["correctOptionId"] is None, ps["question"])

    wait_until(q["startedAt"], off, 0.25)
    st, ra = answer(A, q1["id"], right(q1))   # right, fast
    st, rb = answer(B, q1["id"], wrong(q1))   # wrong
    check("answer is accepted", ra.get("accepted") is True and ra.get("selectedOptionIds") == right(q1), ra)
    check("correctness is hidden until the reveal", ra.get("isCorrect") is None and ra.get("points") is None, ra)
    st, again = answer(A, q1["id"], wrong(q1))
    check("second answer to the same question is refused", again.get("accepted") is False and again.get("reason") == "ALREADY_ANSWERED", again)
    time.sleep(2.0)
    st, rc = answer(C, q1["id"], right(q1))   # right, slower

    def expected_counts(q, answers):
        return {o["id"]: sum(1 for a in answers if o["id"] in a) for o in q["options"]}
    q1_counts = expected_counts(q1, [right(q1), wrong(q1), right(q1)])

    st, scr = rpc("get_screen_state", p_code=code)
    check("big screen shows answered count, no answer key, no leaderboard",
          scr["question"]["answeredCount"] == 3 and scr["reveal"] is None and scr["leaderboard"] is None, scr)
    st, adm = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    live = adm["live"]
    check("presenter sees live distribution and counts",
          live["answered"] == 3 and live["distribution"] == q1_counts and live["notAnswered"] == 1, live)
    st, ps = rpc("get_participant_state", p_token=A)
    check("score is not exposed while the question is open", ps["standing"] is None, ps["standing"])

    wait_until(q["deadline"], off, 0.8)
    st, rd = answer(D, q1["id"], right(q1))
    check("late answer after deadline + grace is rejected", err(rd) == "DEADLINE_PASSED", rd)

    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    st, pa = rpc("get_participant_state", p_token=A)
    st, pd = rpc("get_participant_state", p_token=D)
    check("reveal shows the right answer(s) and points",
          pa["question"]["correctOptionIds"] == right(q1) and pa["question"]["myAnswer"]["isCorrect"] is True
          and pa["question"]["myAnswer"]["points"] > 0, pa["question"])
    check("no answer is recorded as timed out with 0 points",
          pd["question"]["myAnswer"]["status"] == "timed_out" and pd["question"]["myAnswer"]["points"] == 0, pd["question"])
    a_pts = pa["question"]["myAnswer"]["points"]
    a_rt = pa["question"]["myAnswer"]["responseTimeMs"]
    expected = round(1000 * (6000 - a_rt) / 6000)
    check("points follow round(1000 x remaining / total)", abs(a_pts - expected) <= 1, f"points={a_pts} rt={a_rt} expected={expected}")
    st, pc = rpc("get_participant_state", p_token=C)
    check("faster right answer earns more points", pc["question"]["myAnswer"]["points"] < a_pts,
          f"{pc['question']['myAnswer']['points']} vs {a_pts}")
    st, pb = rpc("get_participant_state", p_token=B)
    check("wrong answer earns 0 points", pb["question"]["myAnswer"]["points"] == 0 and pb["question"]["myAnswer"]["isCorrect"] is False)

    st, scr = rpc("get_screen_state", p_code=code)
    order = [row["displayName"] for row in scr["leaderboard"]]
    check("leaderboard order: points, then correct answers, then response time",
          order[:2] == ["Alice", "Carol Smith"] and order[2:] == ["Bob", "Dana"], order)
    check("big screen gets the distribution and the right answers after reveal",
          scr["reveal"]["distribution"] == q1_counts and scr["reveal"]["correctOptionIds"] == right(q1)
          and scr["reveal"]["answeredCount"] == 3, scr["reveal"])

    # ---- concurrency: everyone answers at once, plus a double submit --------
    extra = []
    for i in range(12):
        st, r = rpc("join_session", p_code=code, p_display_name=f"Load {i:02d}")
        extra.append(r["token"])
    st, q2l = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    wait_until(q2l["startedAt"], off, 0.2)
    ids2 = [o["id"] for o in q2["options"]]
    jobs = [(t, ids2[0]) for t in extra] + [(A, ids2[0]), (A, ids2[1]), (B, ids2[-1]), (C, ids2[1])]
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        outs = list(ex.map(lambda j: answer(j[0], q2["id"], [j[1]])[1], jobs))
    accepted = sum(1 for o in outs if isinstance(o, dict) and o.get("accepted") is True)
    alice = [o for (t, _), o in zip(jobs, outs) if t == A]
    check("16 simultaneous submissions: 15 accepted, Alice's double submit counted once",
          accepted == 15 and sum(1 for o in alice if o.get("accepted")) == 1, [o.get("reason", o.get("accepted")) for o in outs])

    # ---- pause and resume ----------------------------------------------------
    rpc("admin_pause", p_admin_token=tok, p_session_id=sid)
    st, r = answer(D, q2["id"], [ids2[0]])
    check("answers are refused while paused", err(r) == "QUESTION_PAUSED", r)
    time.sleep(1.5)
    rpc("admin_resume", p_admin_token=tok, p_session_id=sid)
    st, adm = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    check("resume moves the deadline forward", adm["question"]["deadline"] > q2l["deadline"], (adm["question"]["deadline"], q2l["deadline"]))
    st, r = answer(D, q2["id"], [ids2[0]])
    check("answers are accepted again after resume", r.get("accepted") is True, r)
    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)

    # ---- finish chapter 1 ------------------------------------------------------
    st, r = rpc("admin_finish_chapter", p_admin_token=tok, p_session_id=sid)
    check("chapter cannot finish with unplayed questions", err(r) == "CHAPTER_NOT_FINISHED", r)
    for qq in ch1["questions"][2:]:
        st, qn = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
        wait_until(qn["startedAt"], off, 0.2)
        for t in (A, B, C, D):
            answer(t, qn["questionId"], [qq["options"][0]["id"]])
        rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    n1 = len(ch1["questions"])
    st, r = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    check(f"no question after the chapter's last ({n1})", err(r) == "NO_MORE_QUESTIONS", r)
    rpc("admin_finish_chapter", p_admin_token=tok, p_session_id=sid)
    st, pa = rpc("get_participant_state", p_token=A)
    c1 = pa["chapters"][0]
    check(f"chapter results: status completed, {n1} questions seen", c1["status"] == "completed" and c1["stats"]["seen"] == n1, c1)
    check("standing has rank and totals", pa["standing"]["rank"] >= 1 and pa["standing"]["chaptersCompleted"] == 1, pa["standing"])

    # ---- exports ---------------------------------------------------------------
    st, ex = rpc("admin_export_results", p_admin_token=tok, p_session_id=sid)
    alice_row = next(r for r in ex["rows"] if r["displayName"] == "Alice")
    check("results export has per-chapter points and totals",
          alice_row["chapterPoints"][ch1["id"]] == alice_row["totalPoints"] and alice_row["completionStatus"] == "in_progress", alice_row)
    st, ia = rpc("admin_export_item_analysis", p_admin_token=tok, p_session_id=sid)
    row1 = next(r for r in ia if r["questionId"] == q1["id"])
    check("item analysis counts answers per option, with type and right answers",
          all(row1[f"option{k}"] == v for k, v in q1_counts.items()) and row1["timedOut"] >= 1
          and row1["questionType"] == q1["type"] and row1["correctOptionIds"] == right(q1)
          and row1["optionCount"] == len(q1["options"]), row1)

    # ---- reset, removal, registration -------------------------------------------
    st, r = rpc("admin_reset_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id=ch1["id"], p_confirm="yes")
    check("reset needs the typed confirmation", err(r) == "CONFIRMATION_REQUIRED", r)
    st, r = rpc("admin_reset_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id=ch1["id"], p_confirm="RESET")
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
    ch2 = chapters[1] if len(chapters) > 1 else chapters[0]
    q21 = ch2["questions"][0]
    st, s2 = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] modes",
                 p_settings={"durationOverride": 5, "leadInMs": 0, "graceMs": 300,
                             "scoringMode": "half_floor", "feedbackMode": "immediate"})
    st, j = rpc("join_session", p_code=s2["code"], p_display_name="Slow Sam")
    rpc("admin_start_chapter", p_admin_token=tok, p_session_id=s2["sessionId"], p_chapter_id=ch2["id"])
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=s2["sessionId"])
    time.sleep(4.2)
    # The older form of the call (one option id) still works for single-choice questions.
    if q21.get("type", "single") == "multiple":
        st, r = answer(j["token"], q21["id"], right(q21))
    else:
        st, r = rpc("submit_answer", p_token=j["token"], p_question_id=q21["id"], p_option_id=right(q21)[0])
    check("immediate feedback mode returns correctness at once", r.get("isCorrect") is True, r)
    check("half-floor scoring keeps a late right answer at 500+", r.get("points", 0) >= 500, r)
    rpc("admin_end_session", p_admin_token=tok, p_session_id=s2["sessionId"])

    # ---- bank validation ------------------------------------------------------------
    st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank={"chapters": [{"id": "x"}]})
    check("invalid question bank is rejected", err(r).startswith("BANK_INVALID"), r)

    if BANK_CHANGES:
        bank_editor_checks(tok, off, bank)
    else:
        print("(bank editor checks skipped: set ALLOW_BANK_CHANGES=1 on a test backend to run them)")

    rpc("admin_logout", p_admin_token=tok)
    st, r = rpc("admin_list_sessions", p_admin_token=tok)
    check("logout invalidates the admin token", err(r) == "ADMIN_AUTH_REQUIRED", r)

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    sys.exit(1 if failed else 0)


def chapter_of(tok, cid):
    _, b = rpc("admin_get_bank", p_admin_token=tok)
    return b, next((c for c in b["chapters"] if c["id"] == cid), None)


def bank_editor_checks(tok, off, original):
    # ---- chapters ---------------------------------------------------------------
    st, ch = rpc("admin_save_chapter", p_admin_token=tok, p_chapter={"title": "[Test] فصل الأنواع", "description": "يختبر الأنواع"})
    check("editor: a new chapter gets a chN id and goes last",
          st == 200 and ch["id"].startswith("ch") and ch["order"] == len(original["chapters"]) + 1, ch)
    cid = ch["id"]
    st, r = rpc("admin_save_chapter", p_admin_token=tok,
                p_chapter={"id": cid, "title": "[Test] فصل الأنواع (معدّل)", "description": "", "expectedRevision": ch["revision"]})
    check("editor: renaming a chapter bumps its revision", st == 200 and r["revision"] == ch["revision"] + 1, r)
    st, r = rpc("admin_save_chapter", p_admin_token=tok, p_chapter={"id": cid, "title": "قديم", "expectedRevision": ch["revision"]})
    check("editor: a stale chapter revision is refused", err(r) == "BANK_CONFLICT", r)
    st, r = rpc("admin_save_chapter", p_admin_token=tok, p_chapter={"title": "   "})
    check("editor: an empty chapter title is refused", err(r).startswith("CHAPTER_INVALID"), r)

    st, b = rpc("admin_get_bank", p_admin_token=tok)
    check("editor: an empty chapter is reported as the reason a session cannot start",
          b["problem"] and "[Test]" in b["problem"], b["problem"])
    st, r = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] not ready")
    check("editor: no session while a chapter is empty", err(r).startswith("BANK_NOT_READY:"), r)

    # ---- validation -----------------------------------------------------------------
    base = {"chapterId": cid, "type": "single", "text": "سؤال؟", "options": opts("أحمر", "أخضر", "أزرق"), "correctOptionIds": ["A"]}
    bad_cases = {
        "unknown type": {**base, "type": "essay"},
        "one option": {**base, "options": opts("وحيد")},
        "seven options": {**base, "options": opts(*[f"خيار {i}" for i in range(7)])},
        "option ids out of order": {**base, "options": [{"id": "B", "text": "x"}, {"id": "A", "text": "y"}]},
        "two options with the same text": {**base, "options": opts("نفس", " نفس ")},
        "right answer not an option": {**base, "correctOptionIds": ["D"]},
        "single choice with two right answers": {**base, "correctOptionIds": ["A", "B"]},
        "multiple choice with one right answer": {**base, "type": "multiple", "correctOptionIds": ["A"]},
        "multiple choice with two options": {**base, "type": "multiple", "options": opts("x", "y"), "correctOptionIds": ["A", "B"]},
        "no right answer": {**base, "correctOptionIds": []},
        "empty text": {**base, "text": "  "},
        "time out of range": {**base, "durationSeconds": 200},
        "text over 300 characters": {**base, "text": "س" * 301},
        "option over 120 characters": {**base, "options": opts("ق" * 121, "ب", "ج")},
    }
    not_refused = []
    for name, q in bad_cases.items():
        st, r = rpc("admin_save_question", p_admin_token=tok, p_question=q)
        if not err(r).startswith("QUESTION_INVALID:"):
            not_refused.append((name, r))
    check(f"editor: {len(bad_cases)} kinds of invalid question are refused with a reason", not not_refused, not_refused)

    # ---- the three types -------------------------------------------------------------
    st, single = rpc("admin_save_question", p_admin_token=tok,
                     p_question={**base, "correctOptionIds": ["B"], "explanation": "لأن", "sourceRef": "شريحة 1"})
    st, multi = rpc("admin_save_question", p_admin_token=tok,
                    p_question={"chapterId": cid, "type": "multiple", "text": "اختر كل الصحيح",
                                "options": opts("واحد", "اثنان", "ثلاثة", "أربعة", "خمسة"), "correctOptionIds": ["E", "A"]})
    st, tf = rpc("admin_save_question", p_admin_token=tok,
                 p_question={"chapterId": cid, "type": "true_false", "text": "الأرض تدور؟", "options": opts("نعم", "لا"),
                             "correctOptionIds": ["A"]})
    check("editor: single, multiple and true/false questions are created in order",
          [single.get("order"), multi.get("order"), tf.get("order")] == [1, 2, 3] and single.get("id") == f"{cid}-q1", (single, multi, tf))
    check("editor: right answers are stored sorted; multiple choice defaults to 30 s and the others to 20 s",
          multi["correctOptionIds"] == ["A", "E"] and multi["durationSeconds"] == 30 and single["durationSeconds"] == 20, multi)
    check("editor: true/false always gets the options صح and خطأ", [o["text"] for o in tf["options"]] == ["صح", "خطأ"], tf["options"])

    # ---- reorder ---------------------------------------------------------------------
    rpc("admin_reorder_questions", p_admin_token=tok, p_chapter_id=cid, p_question_ids=[tf["id"], single["id"], multi["id"]])
    b, mine = chapter_of(tok, cid)
    check("editor: questions can be reordered", [q["id"] for q in mine["questions"]] == [tf["id"], single["id"], multi["id"]],
          [q["id"] for q in mine["questions"]])
    st, r = rpc("admin_reorder_questions", p_admin_token=tok, p_chapter_id=cid, p_question_ids=[tf["id"], single["id"]])
    check("editor: a reorder that leaves a question out is refused", err(r) == "ORDER_MISMATCH", r)

    # ---- edit, conflict, history, revert ----------------------------------------------
    st, edited = rpc("admin_save_question", p_admin_token=tok,
                     p_question={**single, "type": "multiple", "correctOptionIds": ["B", "C"], "expectedRevision": single["revision"]})
    check("editor: an edit can change the type and bumps the revision",
          edited.get("type") == "multiple" and edited["revision"] == single["revision"] + 1, edited)
    st, r = rpc("admin_save_question", p_admin_token=tok, p_question={**single, "text": "تعديل قديم", "expectedRevision": single["revision"]})
    check("editor: saving over someone else's change is refused", err(r) == "BANK_CONFLICT", r)
    st, same = rpc("admin_save_question", p_admin_token=tok, p_question={**edited, "expectedRevision": edited["revision"]})
    check("editor: saving without changes keeps the revision", same.get("revision") == edited["revision"], same)
    st, hist = rpc("admin_question_history", p_admin_token=tok, p_question_id=single["id"])
    check("editor: history lists each change, newest first", [h["action"] for h in hist] == ["updated", "created"], [h["action"] for h in hist])
    st, back = rpc("admin_revert_question", p_admin_token=tok, p_question_id=single["id"], p_change_id=hist[-1]["changeId"])
    check("editor: reverting puts back the earlier version as a new change",
          back.get("type") == "single" and back["correctOptionIds"] == ["B"] and back["revision"] == edited["revision"] + 1, back)

    # ---- retire, restore, limit --------------------------------------------------------
    rpc("admin_retire_question", p_admin_token=tok, p_question_id=tf["id"])
    b, mine = chapter_of(tok, cid)
    check("editor: a retired question leaves the chapter and the others close up",
          [q["id"] for q in mine["questions"]] == [single["id"], multi["id"]] and [q["order"] for q in mine["questions"]] == [1, 2]
          and any(q["id"] == tf["id"] for q in b["retired"]["questions"]), mine["questions"])
    st, r = rpc("admin_restore_question", p_admin_token=tok, p_question_id=tf["id"])
    check("editor: a restored question comes back at the end", r.get("order") == 3, r)
    extra_ids = []
    for i in range(7):
        st, r = rpc("admin_save_question", p_admin_token=tok,
                    p_question={**base, "text": f"سؤال إضافي {i}", "options": opts(f"س{i}", f"ص{i}")})
        extra_ids.append(r.get("id"))
    st, r = rpc("admin_save_question", p_admin_token=tok, p_question={**base, "text": "الحادي عشر"})
    check("editor: an eleventh question in a chapter is refused", err(r) == "QUESTION_LIMIT", r)
    for qid in extra_ids:
        rpc("admin_retire_question", p_admin_token=tok, p_question_id=qid)

    # ---- chapter order ------------------------------------------------------------------
    b, _ = chapter_of(tok, cid)
    order = [cid] + [c["id"] for c in b["chapters"] if c["id"] != cid]
    rpc("admin_reorder_chapters", p_admin_token=tok, p_chapter_ids=order)
    b, _ = chapter_of(tok, cid)
    check("editor: chapters can be reordered, and the bank is ready again",
          [c["id"] for c in b["chapters"]] == order and b["problem"] is None, ([c["id"] for c in b["chapters"]], b["problem"]))

    types_session_checks(tok, off, cid, back, multi, tf)

    # ---- import: limits, old file format, one-chapter bank, and back to the original -------
    eleven = {"chapters": [{"id": f"c{i}", "title": f"ف{i}", "questions": [{**base, "id": f"c{i}-q1"}]} for i in range(11)]}
    st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank=eleven)
    check("import: more than 10 chapters is refused", err(r).startswith("BANK_INVALID:"), r)
    st, r = rpc("admin_import_bank", p_admin_token=tok,
                p_bank={"chapters": [{"id": "z1", "title": "ز", "questions": [{**base, "id": "z1-q1", "type": "essay"}]}]})
    check("import: a bad question is refused, naming the question", err(r).startswith("BANK_INVALID:") and "z1-q1" in err(r), r)

    old_format = all(q.get("type", "single") == "single" for c in original["chapters"] for q in c["questions"])
    if old_format:
        legacy = {"chapters": [{"id": c["id"], "title": c["title"], "description": c["description"],
                                "questions": [{"id": q["id"], "text": q["text"], "options": q["options"],
                                               "correctOptionId": right(q)[0], "explanation": q["explanation"],
                                               "durationSeconds": q["durationSeconds"], "sourceRef": q["sourceRef"]}
                                              for q in c["questions"]]} for c in original["chapters"]]}
        st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank=legacy)
        n = sum(len(c["questions"]) for c in original["chapters"])
        check("import: the older file format (correctOptionId, four options) still imports",
              st == 200 and r["questions"] == n and r["retiredQuestions"] >= 3, r)

    one = {"chapters": [{"id": "solo", "title": "فصل وحيد", "questions": [{**base, "id": "solo-q1"}]}]}
    st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank=one)
    check("import: a one-chapter, one-question bank is allowed", st == 200 and r["chapters"] == 1 and r["questions"] == 1, r)
    st, r = rpc("admin_retire_chapter", p_admin_token=tok, p_chapter_id="solo")
    check("editor: the last chapter cannot be retired", err(r) == "BANK_NEEDS_CHAPTER", r)

    st, r = rpc("admin_import_bank", p_admin_token=tok, p_bank=original)
    st, b = rpc("admin_get_bank", p_admin_token=tok)
    same_bank = [(c["id"], [(q["id"], q["text"], q["correctOptionIds"]) for q in c["questions"]]) for c in b["chapters"]] == \
                [(c["id"], [(q["id"], q["text"], q["correctOptionIds"]) for q in c["questions"]]) for c in original["chapters"]]
    check("import: the original bank is back (the test chapter is retired, not deleted)",
          st == 200 and same_bank and any(c["id"] == cid for c in b["retired"]["chapters"]), r)


def types_session_checks(tok, off, cid, single, multi, tf):
    st, s = rpc("admin_create_session", p_admin_token=tok, p_title="[Test] question types",
                p_settings={"leadInMs": 300, "graceMs": 500, "durationOverride": 8})
    sid, code = s["sessionId"], s["code"]
    # An edit after the session exists does not reach the session.
    st, changed = rpc("admin_save_question", p_admin_token=tok, p_question={**single, "text": "نص بعد إنشاء الجلسة"})
    check("types: the bank edit after the session was created is saved", changed.get("text") == "نص بعد إنشاء الجلسة", changed)
    tokens = {}
    for name in ["Exact", "Partial", "Extra", "Late"]:
        st, j = rpc("join_session", p_code=code, p_display_name=name)
        tokens[name] = j["token"]
    E, P, X, L = tokens["Exact"], tokens["Partial"], tokens["Extra"], tokens["Late"]
    st, r = rpc("admin_start_chapter", p_admin_token=tok, p_session_id=sid, p_chapter_id=cid)

    # single choice
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    st, ps = rpc("get_participant_state", p_token=E)
    check("types: the session keeps the text it was created with",
          q.get("questionId") == single["id"] and ps["question"]["text"] == single["text"] and ps["question"]["type"] == "single", ps["question"])
    wait_until(q["startedAt"], off, 0.2)
    st, r = answer(E, single["id"], ["A", "B"])
    check("types: single choice refuses two options", err(r) == "INVALID_OPTION", r)
    st, r = answer(E, single["id"], ["Z"])
    check("types: an option that does not exist is refused", err(r) == "INVALID_OPTION", r)
    answer(E, single["id"], ["B"])
    answer(P, single["id"], ["A"])
    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)

    # multiple choice: all or nothing
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    st, ps = rpc("get_participant_state", p_token=E)
    check("types: phones learn a question is multiple choice", ps["question"]["type"] == "multiple" and len(ps["question"]["options"]) == 5, ps["question"])
    wait_until(q["startedAt"], off, 0.2)
    st, re_ = answer(E, multi["id"], ["E", "A", "A"])
    st, rp = answer(P, multi["id"], ["A"])
    st, rx = answer(X, multi["id"], ["A", "B", "E"])
    st, r0 = answer(L, multi["id"], [])
    check("types: answers with one or several options are accepted; an empty one is refused",
          re_.get("accepted") and re_.get("selectedOptionIds") == ["A", "E"] and rp.get("accepted") and rx.get("accepted")
          and err(r0) == "INVALID_OPTION", (re_, rp, rx, r0))
    st, again = answer(E, multi["id"], ["A"])
    check("types: one attempt per multiple-choice question", again.get("reason") == "ALREADY_ANSWERED" and again.get("selectedOptionIds") == ["A", "E"], again)
    st, adm = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    expected = {"A": 3, "B": 1, "C": 0, "D": 0, "E": 2}
    check("types: the presenter sees how many chose each option", adm["live"]["distribution"] == expected and adm["live"]["answered"] == 3, adm["live"])
    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    st, pe = rpc("get_participant_state", p_token=E)
    st, pp = rpc("get_participant_state", p_token=P)
    st, px = rpc("get_participant_state", p_token=X)
    st, pl = rpc("get_participant_state", p_token=L)
    me, mp, mx, ml = (x["question"]["myAnswer"] for x in (pe, pp, px, pl))
    check("types: exactly the right set scores; a missing or an extra option scores 0",
          me["isCorrect"] is True and me["points"] > 0 and mp["isCorrect"] is False and mp["points"] == 0
          and mx["isCorrect"] is False and mx["points"] == 0, (me, mp, mx))
    check("types: no answer is a time-out", ml["status"] == "timed_out", ml)
    check("types: the reveal lists every right answer", pe["question"]["correctOptionIds"] == ["A", "E"] and pe["question"]["correctOptionId"] == "A", pe["question"])
    st, scr = rpc("get_screen_state", p_code=code)
    check("types: the big screen gets all right answers and per-option counts",
          scr["reveal"]["correctOptionIds"] == ["A", "E"] and scr["reveal"]["distribution"] == expected
          and scr["reveal"]["answeredCount"] == 3 and scr["reveal"]["correctCount"] == 1, scr["reveal"])

    # true / false
    st, q = rpc("admin_next_question", p_admin_token=tok, p_session_id=sid)
    wait_until(q["startedAt"], off, 0.2)
    st, rt = answer(E, tf["id"], ["A"])
    st, rf = answer(P, tf["id"], ["B"])
    st, rc = answer(X, tf["id"], ["C"])
    check("types: true/false takes A (صح) or B (خطأ) only", rt.get("accepted") and rf.get("accepted") and err(rc) == "INVALID_OPTION", (rt, rf, rc))
    rpc("admin_reveal", p_admin_token=tok, p_session_id=sid)
    st, pe = rpc("get_participant_state", p_token=E)
    st, pp = rpc("get_participant_state", p_token=P)
    check("types: true/false is scored like single choice",
          pe["question"]["myAnswer"]["isCorrect"] is True and pp["question"]["myAnswer"]["isCorrect"] is False, (pe["question"]["myAnswer"], pp["question"]["myAnswer"]))

    st, ia = rpc("admin_export_item_analysis", p_admin_token=tok, p_session_id=sid)
    rows = {r["questionId"]: r for r in ia}
    m = rows[multi["id"]]
    check("types: question analysis has the type, the right answers and up to six option counts",
          [rows[x]["questionType"] for x in (single["id"], multi["id"], tf["id"])] == ["single", "multiple", "true_false"]
          and m["correctOptionIds"] == ["A", "E"] and m["optionCount"] == 5 and m["optionE"] == 2 and m["optionA"] == 3
          and rows[tf["id"]]["optionCount"] == 2, m)
    st, b = rpc("admin_get_session", p_admin_token=tok, p_session_id=sid)
    rpc("admin_finish_chapter", p_admin_token=tok, p_session_id=sid)
    st, pe = rpc("get_participant_state", p_token=E)
    check("types: Exact answered all three right", pe["standing"]["correctCount"] == 3, pe["standing"])
    rpc("admin_end_session", p_admin_token=tok, p_session_id=sid)


if __name__ == "__main__":
    main()
