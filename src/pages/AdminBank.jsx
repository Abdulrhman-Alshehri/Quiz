import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { useAdminToken } from '../lib/useAdmin';
import {
  addOption,
  changeType,
  charCount,
  draftFrom,
  limitsOf,
  minOptionsFor,
  moveId,
  newQuestion,
  removeOption,
  sameDraft,
  setOptionText,
  toggleCorrect,
  toPayload,
  validateChapter,
  validateQuestion,
} from '../utils/bank';
import { answerSummary, count, dateTime, optionLetter, QUESTION_TYPES, typeLabel } from '../utils/format';
import { BankFileActions } from '../components/BankFile';
import { Logo } from '../components/Brand';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { OptionButton, Shape } from '../components/Options';
import { Notice, Spinner } from '../components/ui';
import AdminLogin from './AdminLogin';

// Question bank editor: chapters and questions are added, edited, reordered,
// retired and restored one at a time. Every save is checked again by the
// database and logged, so any question can be put back as it was.
export default function AdminBank() {
  const { admin, signIn, signOut } = useAdminToken();
  if (!admin) return <AdminLogin onSignedIn={signIn} reason="سجل الدخول لتحرير بنك الأسئلة." />;
  return <BankEditor token={admin.token} onSignOut={signOut} />;
}

const ACTION_LABEL = {
  created: 'أُنشئ',
  updated: 'عُدّل',
  retired: 'أُوقف',
  restored: 'أُعيد',
  reverted: 'استُعيدت نسخة سابقة',
  imported: 'استُورد من ملف',
};

function BankEditor({ token, onSignOut }) {
  const [bank, setBank] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [questionEdit, setQuestionEdit] = useState(null); // { key, initial, error, conflict }
  const [chapterEdit, setChapterEdit] = useState(null); // { draft, error }
  const [history, setHistory] = useState(null); // { question, items }
  const [confirm, setConfirm] = useState(null); // { kind, item }
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const closeQuestion = useRef(null);

  const authFailed = useCallback(
    (e) => {
      if (e?.code === 'ADMIN_AUTH_REQUIRED') {
        onSignOut();
        return true;
      }
      return false;
    },
    [onSignOut],
  );

  const load = useCallback(async () => {
    try {
      const next = await api.admin.getBank(token);
      setBank(next);
      setLoadError(null);
      return next;
    } catch (e) {
      if (!authFailed(e)) setLoadError(e);
      return null;
    }
  }, [token, authFailed]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const highlight = (id) => {
    setFlash(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  };

  // Runs one change, reloads the bank, and reports the outcome in the page notice.
  const run = async (fn, success, { keepOpen } = {}) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      await load();
      if (success) setNotice({ tone: 'success', text: typeof success === 'function' ? success(res) : success });
      return { ok: true, res };
    } catch (e) {
      if (authFailed(e)) return { ok: false };
      if (['BANK_CONFLICT', 'ORDER_MISMATCH', 'QUESTION_NOT_FOUND', 'CHAPTER_NOT_FOUND'].includes(e.code)) await load();
      if (!keepOpen) setNotice({ tone: 'error', text: messageFor(e) });
      return { ok: false, error: e };
    } finally {
      setBusy(false);
    }
  };

  if (!bank) {
    return (
      <main className="admin">
        <EditorBar />
        <div className="editor">
          {loadError ? <Notice tone="error">{messageFor(loadError)}</Notice> : <Spinner label="جارٍ تحميل بنك الأسئلة…" />}
        </div>
      </main>
    );
  }

  const limits = limitsOf(bank);
  const chapters = bank.chapters;
  const total = chapters.reduce((n, c) => n + c.questions.length, 0);
  const chapterIds = chapters.map((c) => c.id);
  const retiredCount = bank.retired.chapters.length + bank.retired.questions.length;

  const saveQuestion = async (draft) => {
    const isNew = !draft.id;
    const target = chapters.find((c) => c.id === draft.chapterId);
    const out = await run(
      () => api.admin.saveQuestion(token, toPayload(draft)),
      isNew ? `أُضيف السؤال إلى «${target?.title || ''}».` : 'حُفظ السؤال.',
      { keepOpen: true },
    );
    if (out.ok) {
      setQuestionEdit(null);
      highlight(out.res.id);
    } else if (out.error) {
      setQuestionEdit((cur) => (cur ? { ...cur, error: messageFor(out.error), conflict: out.error.code === 'BANK_CONFLICT' } : cur));
    }
  };

  // After a conflict: start again from the version someone else saved.
  const reopenLatest = (id) => {
    const latest = bank.chapters.flatMap((c) => c.questions).find((q) => q.id === id);
    if (latest) setQuestionEdit({ key: Date.now(), initial: draftFrom(latest) });
    else setQuestionEdit(null);
  };

  const saveChapter = async (draft) => {
    const isNew = !draft.id;
    const payload = { title: draft.title.trim(), description: draft.description.trim() };
    if (!isNew) {
      payload.id = draft.id;
      payload.expectedRevision = draft.revision;
    }
    const out = await run(() => api.admin.saveChapter(token, payload), isNew ? 'أُضيف الفصل.' : 'حُفظ الفصل.', { keepOpen: true });
    if (out.ok) {
      setChapterEdit(null);
      highlight(out.res.id);
    } else if (out.error) {
      setChapterEdit((cur) => (cur ? { ...cur, error: messageFor(out.error) } : cur));
    }
  };

  const openHistory = async (question) => {
    setBusy(true);
    try {
      const items = await api.admin.questionHistory(token, question.id);
      setHistory({ question, items });
    } catch (e) {
      if (!authFailed(e)) setNotice({ tone: 'error', text: messageFor(e) });
    } finally {
      setBusy(false);
    }
  };

  const revert = async (item) => {
    const out = await run(() => api.admin.revertQuestion(token, history.question.id, item.changeId), 'استُعيدت النسخة السابقة من السؤال.');
    if (out.ok) {
      setHistory(null);
      highlight(history.question.id);
    }
  };

  return (
    <main className="admin">
      <EditorBar />
      <div className="editor">
        <section className="card editor__intro" aria-labelledby="editor-title">
          <h1 id="editor-title" className="h2">بنك الأسئلة</h1>
          <p className="muted">
            التعديلات تنطبق على الجلسات التي تُنشأ بعدها، والجلسات الموجودة تحتفظ بأسئلتها. كل حفظ يُسجَّل، ويمكن إعادة أي سؤال إلى
            نسخة سابقة من «السجل».
          </p>
          <p className="editor__totals">
            {count(chapters.length, 'chapter')}، {count(total, 'question')}. الحد الأقصى {limits.maxChapters} فصول، و
            {limits.maxQuestionsPerChapter} أسئلة في كل فصل.
          </p>
          {bank.problem ? (
            <Notice tone="warn">لا يمكن إنشاء جلسة بعد: {bank.problem}</Notice>
          ) : (
            <Notice tone="success">البنك جاهز. أي جلسة جديدة ستستخدم هذه الأسئلة.</Notice>
          )}
          <div className="btn-row">
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy || chapters.length >= limits.maxChapters}
              onClick={() => setChapterEdit({ draft: { id: null, title: '', description: '', revision: null } })}
            >
              إضافة فصل
            </button>
          </div>
          <details className="editor__files">
            <summary>الاستيراد من ملف والتنزيل</summary>
            <BankFileActions token={token} bank={bank} onImported={() => load()} onAuthError={authFailed} />
          </details>
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </section>

        {chapters.map((c, i) => (
          <ChapterCard
            key={c.id}
            chapter={c}
            index={i}
            last={i === chapters.length - 1}
            limits={limits}
            busy={busy}
            flash={flash}
            onMove={(step) => run(() => api.admin.reorderChapters(token, moveId(chapterIds, c.id, step)), null)}
            onEdit={() => setChapterEdit({ draft: { id: c.id, title: c.title, description: c.description, revision: c.revision } })}
            onRetire={() => setConfirm({ kind: 'retireChapter', item: c })}
            onAddQuestion={() => setQuestionEdit({ key: Date.now(), initial: newQuestion(c.id, 'single', limits) })}
            onEditQuestion={(q) => setQuestionEdit({ key: Date.now(), initial: draftFrom(q) })}
            onMoveQuestion={(q, step) =>
              run(() => api.admin.reorderQuestions(token, c.id, moveId(c.questions.map((x) => x.id), q.id, step)), null)
            }
            onHistory={openHistory}
            onRetireQuestion={(q) => setConfirm({ kind: 'retireQuestion', item: q, chapter: c })}
          />
        ))}

        {retiredCount > 0 && (
          <RetiredPanel
            retired={bank.retired}
            busy={busy}
            onRestoreChapter={(c) => run(() => api.admin.restoreChapter(token, c.id), `أُعيد الفصل «${c.title}» مع أسئلته.`)}
            onRestoreQuestion={(q) => run(() => api.admin.restoreQuestion(token, q.id), 'أُعيد السؤال إلى آخر فصله.')}
          />
        )}
      </div>

      <Modal
        open={!!questionEdit}
        labelledBy="qform-title"
        wide
        busy={busy}
        onClose={() => (closeQuestion.current ? closeQuestion.current() : setQuestionEdit(null))}
      >
        {questionEdit && (
          <QuestionForm
            key={questionEdit.key}
            initial={questionEdit.initial}
            chapters={chapters}
            limits={limits}
            busy={busy}
            serverError={questionEdit.error}
            conflict={questionEdit.conflict}
            closeRef={closeQuestion}
            onReopenLatest={() => reopenLatest(questionEdit.initial.id)}
            onSave={saveQuestion}
            onCancel={() => setQuestionEdit(null)}
          />
        )}
      </Modal>

      <Modal open={!!chapterEdit} labelledBy="cform-title" busy={busy} onClose={() => setChapterEdit(null)}>
        {chapterEdit && (
          <ChapterForm
            initial={chapterEdit.draft}
            limits={limits}
            busy={busy}
            serverError={chapterEdit.error}
            onSave={saveChapter}
            onCancel={() => setChapterEdit(null)}
          />
        )}
      </Modal>

      <Modal open={!!history} labelledBy="history-title" wide busy={busy} onClose={() => setHistory(null)}>
        {history && <HistoryView history={history} busy={busy} onRevert={revert} onClose={() => setHistory(null)} />}
      </Modal>

      <ConfirmDialog
        open={confirm?.kind === 'retireChapter'}
        title={`إيقاف الفصل «${confirm?.item?.title || ''}»؟`}
        confirmLabel="إيقاف الفصل"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.retireChapter(token, confirm.item.id), `أُوقف الفصل «${confirm.item.title}». تجده مع أسئلته في «الموقوفة».`);
          setConfirm(null);
        }}
      >
        <p>
          لن يظهر الفصل وأسئلته ({count(confirm?.item?.questions?.length || 0, 'question')}) في الجلسات الجديدة. لا يُحذف شيء، ويمكن
          استعادته في أي وقت.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'retireQuestion'}
        title="إيقاف هذا السؤال؟"
        confirmLabel="إيقاف السؤال"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.retireQuestion(token, confirm.item.id), 'أُوقف السؤال. تجده في «الموقوفة».');
          setConfirm(null);
        }}
      >
        <p>
          «{confirm?.item?.text}»
          <br />
          لن يظهر في الجلسات الجديدة، ويمكن استعادته في أي وقت.
          {confirm?.chapter && confirm.chapter.questions.length === 1 ? ' هذا آخر سؤال في الفصل: لن تُنشأ جلسة حتى تضيف سؤالًا أو توقف الفصل.' : ''}
        </p>
      </ConfirmDialog>
    </main>
  );
}

function EditorBar() {
  return (
    <header className="admin__bar on-blue">
      <Logo />
      <a className="admin__brand" href="#/admin">مسابقة NPS المباشرة</a>
      <span className="admin__where">تحرير بنك الأسئلة</span>
      <a className="btn btn--quiet" href="#/admin">
        العودة إلى الجلسات
      </a>
    </header>
  );
}

function ChapterCard({
  chapter: c,
  index,
  last,
  limits,
  busy,
  flash,
  onMove,
  onEdit,
  onRetire,
  onAddQuestion,
  onEditQuestion,
  onMoveQuestion,
  onHistory,
  onRetireQuestion,
}) {
  const full = c.questions.length >= limits.maxQuestionsPerChapter;
  const n = index + 1;
  return (
    <section className={`card chapter-card${flash === c.id ? ' is-flash' : ''}`} aria-labelledby={`chapter-${c.id}`} data-chapter={c.id}>
      <div className="chapter-card__head">
        <span className="chapter-card__num" aria-hidden="true">{n}</span>
        <div className="chapter-card__info">
          <h2 id={`chapter-${c.id}`} className="h3">
            <span className="sr-only">الفصل {n}: </span>
            {c.title}
          </h2>
          {c.description && <p className="muted small">{c.description}</p>}
          <p className="muted small">{count(c.questions.length, 'question')}</p>
        </div>
        <div className="chapter-card__actions">
          <button className="btn btn--quiet btn--xs" type="button" disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label={`نقل الفصل ${n} لأعلى`}>
            ↑
          </button>
          <button className="btn btn--quiet btn--xs" type="button" disabled={busy || last} onClick={() => onMove(1)} aria-label={`نقل الفصل ${n} لأسفل`}>
            ↓
          </button>
          <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={onEdit}>
            تعديل الفصل
          </button>
          <button className="btn btn--quiet btn--s" type="button" disabled={busy} onClick={onRetire}>
            إيقاف الفصل
          </button>
        </div>
      </div>

      {c.questions.length === 0 && (
        <Notice tone="warn">لا أسئلة في هذا الفصل. أضف سؤالًا، أو أوقف الفصل، حتى يمكن إنشاء جلسة.</Notice>
      )}
      <ol className="qlist">
        {c.questions.map((q, j) => (
          <li key={q.id} className={`qrow${flash === q.id ? ' is-flash' : ''}`} data-question={q.id}>
            <span className="qrow__num" aria-hidden="true">{j + 1}</span>
            <div className="qrow__body">
              <p className="qrow__text">
                <span className="sr-only">السؤال {j + 1}: </span>
                {q.text}
              </p>
              <p className="qrow__meta">
                <span className={`chip chip--${q.type}`}>{typeLabel(q.type)}</span>
                <span>الصحيحة: {answerSummary(q)}</span>
                <span>{count(q.options.length, 'option')}</span>
                <span>{q.durationSeconds} ث</span>
                {q.sourceRef && (
                  <span>
                    <bdi>{q.sourceRef}</bdi>
                  </span>
                )}
              </p>
            </div>
            <div className="qrow__actions">
              <button className="btn btn--quiet btn--xs" type="button" disabled={busy || j === 0} onClick={() => onMoveQuestion(q, -1)} aria-label={`نقل السؤال ${j + 1} لأعلى`}>
                ↑
              </button>
              <button
                className="btn btn--quiet btn--xs"
                type="button"
                disabled={busy || j === c.questions.length - 1}
                onClick={() => onMoveQuestion(q, 1)}
                aria-label={`نقل السؤال ${j + 1} لأسفل`}
              >
                ↓
              </button>
              <button className="btn btn--outline btn--xs" type="button" disabled={busy} onClick={() => onEditQuestion(q)} aria-label={`تعديل السؤال ${j + 1}`}>
                تعديل
              </button>
              <button className="btn btn--quiet btn--xs" type="button" disabled={busy} onClick={() => onHistory(q)} aria-label={`سجل السؤال ${j + 1}`}>
                السجل
              </button>
              <button className="btn btn--quiet btn--xs" type="button" disabled={busy} onClick={() => onRetireQuestion(q)} aria-label={`إيقاف السؤال ${j + 1}`}>
                إيقاف
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="chapter-card__foot">
        <button className="btn btn--outline btn--s" type="button" disabled={busy || full} onClick={onAddQuestion} aria-label={`إضافة سؤال إلى الفصل ${n}`}>
          إضافة سؤال
        </button>
        {full && <span className="muted small">اكتمل الفصل ({limits.maxQuestionsPerChapter} أسئلة).</span>}
      </div>
    </section>
  );
}

function Counter({ text, max }) {
  const n = charCount(text);
  return (
    <span className={`counter${n > max * 0.9 ? ' is-near' : ''}`} aria-hidden="true">
      {n}/{max}
    </span>
  );
}

function QuestionForm({ initial, chapters, limits, busy, serverError, conflict, closeRef, onReopenLatest, onSave, onCancel }) {
  const [draft, setDraft] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const errors = validateQuestion(draft, limits);
  const valid = Object.keys(errors).length === 0;
  const dirty = !sameDraft(draft, initial);
  const multi = draft.type === 'multiple';
  const tf = draft.type === 'true_false';
  const bad = new Set(errors.optionIds || []);
  const update = (patch) => {
    setLeaving(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const change = (fn) => {
    setLeaving(false);
    setDraft(fn);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    onSave(draft);
  };
  const cancel = () => {
    if (dirty && !leaving) {
      setLeaving(true);
      return;
    }
    onCancel();
  };
  // Escape goes through the same check, so unsaved changes are never lost silently.
  useEffect(() => {
    if (!closeRef) return undefined;
    closeRef.current = cancel;
    return () => {
      closeRef.current = null;
    };
  });

  const optionsError = showErrors && (errors.options || errors.correct);
  return (
    <form className="qform" onSubmit={submit} noValidate>
      <h2 id="qform-title" className="dialog__title">
        {draft.id ? 'تعديل السؤال' : 'سؤال جديد'}
      </h2>
      <div className="dialog__body qform__body">
        <label className="field">
          <span className="field__label">الفصل</span>
          <select className="input" value={draft.chapterId || ''} onChange={(e) => update({ chapterId: e.target.value })}>
            {chapters.map((c, i) => (
              <option key={c.id} value={c.id}>
                {`الفصل ${i + 1}: ${c.title}`}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field">
          <legend className="field__label">نوع السؤال</legend>
          <div className="segmented">
            {Object.entries(QUESTION_TYPES).map(([value, t]) => (
              <label key={value} className={`segmented__item${draft.type === value ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="question-type"
                  value={value}
                  checked={draft.type === value}
                  onChange={() => change((d) => changeType(d, value, limits))}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
          <p className="muted small">{QUESTION_TYPES[draft.type]?.hint}</p>
        </fieldset>

        <label className="field">
          <span className="field__label field__label--row">
            <span>نص السؤال</span>
            <Counter text={draft.text} max={limits.maxText} />
          </span>
          <textarea
            className="input"
            rows={3}
            value={draft.text}
            maxLength={limits.maxText}
            onChange={(e) => update({ text: e.target.value })}
            aria-invalid={!!(showErrors && errors.text)}
          />
          {showErrors && errors.text && <span className="field__error">{errors.text}</span>}
        </label>

        <fieldset className="field">
          <legend className="field__label">
            {multi ? 'الخيارات: ضع علامة على كل الإجابات الصحيحة' : 'الخيارات: اختر الإجابة الصحيحة'}
          </legend>
          <ol className="optedit">
            {draft.options.map((o) => {
              const right = draft.correctOptionIds.includes(o.id);
              const letter = optionLetter(o.id);
              return (
                <li key={o.id} className={`optedit__row${right ? ' is-right' : ''}${showErrors && bad.has(o.id) ? ' is-bad' : ''}`}>
                  <span className={`optedit__mark opt--${o.id.toLowerCase()}`} aria-hidden="true">
                    <Shape id={o.id} />
                    <span>{letter}</span>
                  </span>
                  {tf ? (
                    <span className="optedit__fixed">{o.text}</span>
                  ) : (
                    <input
                      className="input"
                      value={o.text}
                      maxLength={limits.maxOption}
                      onChange={(e) => change((d) => setOptionText(d, o.id, e.target.value))}
                      aria-label={`نص الخيار ${letter}`}
                      aria-invalid={!!(showErrors && bad.has(o.id))}
                    />
                  )}
                  <label className="optedit__right">
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name="right-answer"
                      checked={right}
                      onChange={() => change((d) => toggleCorrect(d, o.id))}
                      aria-label={`${letter} إجابة صحيحة`}
                    />
                    <span aria-hidden="true">صحيحة</span>
                  </label>
                  {!tf && (
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      disabled={draft.options.length <= minOptionsFor(draft.type, limits)}
                      onClick={() => change((d) => removeOption(d, o.id, limits))}
                      aria-label={`حذف الخيار ${letter}`}
                    >
                      حذف
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {!tf && (
            <div className="optedit__foot">
              <button
                type="button"
                className="btn btn--outline btn--s"
                disabled={draft.options.length >= limits.maxOptions}
                onClick={() => change((d) => addOption(d, limits))}
              >
                إضافة خيار
              </button>
              <span className="muted small">
                {count(draft.options.length, 'option')} من {limits.maxOptions} على الأكثر.
              </span>
            </div>
          )}
          {optionsError && <span className="field__error">{errors.options || errors.correct}</span>}
        </fieldset>

        <label className="field">
          <span className="field__label field__label--row">
            <span>التوضيح الذي يظهر بعد كشف الإجابة</span>
            <Counter text={draft.explanation} max={limits.maxExplanation} />
          </span>
          <textarea
            className="input"
            rows={2}
            value={draft.explanation}
            maxLength={limits.maxExplanation}
            onChange={(e) => update({ explanation: e.target.value })}
          />
        </label>

        <div className="row">
          <label className="field">
            <span className="field__label">المدة بالثواني</span>
            <input
              className="input input--num"
              type="number"
              min={limits.minSeconds}
              max={limits.maxSeconds}
              value={draft.durationSeconds}
              onChange={(e) => update({ durationSeconds: e.target.value === '' ? '' : Number(e.target.value) })}
              aria-invalid={!!(showErrors && errors.durationSeconds)}
            />
            {showErrors && errors.durationSeconds && <span className="field__error">{errors.durationSeconds}</span>}
          </label>
          <label className="field">
            <span className="field__label">المرجع (مثل: شريحة 12)</span>
            <input className="input" value={draft.sourceRef} maxLength={limits.maxSourceRef} onChange={(e) => update({ sourceRef: e.target.value })} />
          </label>
        </div>

        <details className="qform__preview">
          <summary>معاينة كما يراها المشارك</summary>
          <div className="qform__phone">
            {draft.type !== 'single' && (
              <p className={`q__type q__type--${draft.type}`}>
                {typeLabel(draft.type)}
                {multi ? ': اختر كل الإجابات الصحيحة' : ''}
              </p>
            )}
            <p className="q__text">{draft.text || 'نص السؤال'}</p>
            <div className={`opts opts--n${draft.options.length}${tf ? ' opts--tf' : ''}`}>
              {draft.options.map((o) => (
                <OptionButton key={o.id} option={{ id: o.id, text: o.text || '…' }} state="idle" disabled multi={multi} />
              ))}
            </div>
          </div>
        </details>

        {showErrors && !valid && <Notice tone="error">راجع الحقول المشار إليها قبل الحفظ.</Notice>}
        {serverError && (
          <Notice
            tone="error"
            action={
              conflict ? (
                <button type="button" className="btn btn--outline btn--xs" onClick={onReopenLatest}>
                  افتح أحدث نسخة
                </button>
              ) : null
            }
          >
            {serverError}
          </Notice>
        )}
        {leaving && <Notice tone="warn">لديك تغييرات لم تُحفظ. اضغط «تجاهل التغييرات» للخروج دون حفظ.</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--quiet" onClick={cancel} disabled={busy}>
          {leaving ? 'تجاهل التغييرات' : 'إلغاء'}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ السؤال'}
        </button>
      </div>
    </form>
  );
}

function ChapterForm({ initial, limits, busy, serverError, onSave, onCancel }) {
  const [draft, setDraft] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const errors = validateChapter(draft, limits);
  const submit = (e) => {
    e.preventDefault();
    if (Object.keys(errors).length) {
      setShowErrors(true);
      return;
    }
    onSave(draft);
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 id="cform-title" className="dialog__title">
        {draft.id ? 'تعديل الفصل' : 'فصل جديد'}
      </h2>
      <div className="dialog__body stack">
        <label className="field">
          <span className="field__label field__label--row">
            <span>عنوان الفصل</span>
            <Counter text={draft.title} max={limits.maxTitle} />
          </span>
          <input
            className="input"
            value={draft.title}
            maxLength={limits.maxTitle}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            aria-invalid={!!(showErrors && errors.title)}
          />
          {showErrors && errors.title && <span className="field__error">{errors.title}</span>}
        </label>
        <label className="field">
          <span className="field__label field__label--row">
            <span>وصف قصير يظهر في بداية الفصل (اختياري)</span>
            <Counter text={draft.description} max={limits.maxDescription} />
          </span>
          <textarea
            className="input"
            rows={2}
            value={draft.description}
            maxLength={limits.maxDescription}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
        {serverError && <Notice tone="error">{serverError}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>
          إلغاء
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الفصل'}
        </button>
      </div>
    </form>
  );
}

function HistoryView({ history, busy, onRevert, onClose }) {
  const { question, items } = history;
  return (
    <div className="dialog__panel">
      <h2 id="history-title" className="dialog__title">سجل السؤال</h2>
      <div className="dialog__body">
        <p className="muted small">
          كل حفظ يضيف نسخة. «استعادة هذه النسخة» تعيد نص السؤال ونوعه وخياراته وإجاباته كما كانت، وتُسجَّل نسخةً جديدة.
        </p>
        <p className="history__current">{question.text}</p>
        <ol className="history">
          {items.map((it, i) => {
            const snap = it.snapshot || {};
            return (
              <li key={it.changeId} className="history__item">
                <div className="history__head">
                  <strong>{ACTION_LABEL[it.action] || it.action}</strong>
                  <span className="muted small">{dateTime(it.changedAt)}</span>
                  {i === 0 && <span className="chip">النسخة الحالية</span>}
                </div>
                <p className="history__text">{snap.text}</p>
                <p className="muted small">
                  {typeLabel(snap.type)} · الصحيحة: {answerSummary(snap)} · {count((snap.options || []).length, 'option')}
                </p>
                {i > 0 && (
                  <button className="btn btn--outline btn--xs" type="button" disabled={busy} onClick={() => onRevert(it)}>
                    استعادة هذه النسخة
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
          إغلاق
        </button>
      </div>
    </div>
  );
}

function RetiredPanel({ retired, busy, onRestoreChapter, onRestoreQuestion }) {
  const n = retired.chapters.length + retired.questions.length;
  return (
    <details className="card retired">
      <summary>الموقوفة ({n})</summary>
      <p className="muted small">لا يُحذف شيء من البنك. ما يُوقف لا يظهر في الجلسات الجديدة، ويمكن استعادته هنا.</p>
      {retired.chapters.length > 0 && (
        <>
          <h3 className="h4">فصول</h3>
          <ul className="retired__list">
            {retired.chapters.map((c) => (
              <li key={c.id}>
                <span className="retired__text">
                  <strong>{c.title}</strong> <span className="muted small">({count(c.questionCount, 'question')}، أُوقف {dateTime(c.retiredAt)})</span>
                </span>
                <button className="btn btn--outline btn--xs" type="button" disabled={busy} onClick={() => onRestoreChapter(c)}>
                  استعادة الفصل
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {retired.questions.length > 0 && (
        <>
          <h3 className="h4">أسئلة</h3>
          <ul className="retired__list">
            {retired.questions.map((q) => (
              <li key={q.id}>
                <span className="retired__text">
                  {q.text}{' '}
                  <span className="muted small">
                    ({typeLabel(q.type)}، {q.chapterTitle}
                    {q.chapterRetired ? '، فصله موقوف: استعد الفصل أولًا' : ''})
                  </span>
                </span>
                <button className="btn btn--outline btn--xs" type="button" disabled={busy || q.chapterRetired} onClick={() => onRestoreQuestion(q)}>
                  استعادة
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
