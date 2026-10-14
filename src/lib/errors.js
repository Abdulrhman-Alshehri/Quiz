// Database functions raise short codes (for example NAME_TAKEN). This file turns
// them into plain-language messages that say what happened and what to do next.
const MESSAGES = {
  NETWORK: 'لا يوجد اتصال الآن. تحقق من الإنترنت؛ الصفحة تعيد المحاولة تلقائيًا.',
  NOT_CONFIGURED: 'هذه النسخة من المسابقة غير مرتبطة بقاعدة بيانات بعد.',
  SESSION_NOT_FOUND: 'لا توجد مسابقة بهذا الرمز. تحقق من الرمز على الشاشة الكبيرة وحاول مرة أخرى.',
  SESSION_ENDED: 'انتهت هذه المسابقة.',
  REGISTRATION_CLOSED: 'الانضمام مغلق في هذه المسابقة. اطلب من المقدم إعادة فتحه.',
  NAME_REQUIRED: 'اكتب اسمك للانضمام.',
  NAME_TOO_LONG: 'استخدم 30 حرفًا أو أقل.',
  NAME_INVALID: 'احذف الرموز الخاصة من اسمك.',
  NAME_TAKEN: 'انضم شخص بهذا الاسم من قبل. أضف الحرف الأول من اسم العائلة أو اسم فرعك، مثل «عمر ج».',
  PARTICIPANT_NOT_FOUND: 'تعذر العثور على مكانك في هذه المسابقة. انضم مرة أخرى باسمك.',
  PARTICIPANT_REMOVED: 'أزال المقدم هذا الاسم من المسابقة.',
  QUESTION_CLOSED: 'هذا السؤال مغلق بالفعل.',
  QUESTION_NOT_ACTIVE: 'هذا السؤال لم يعد مفتوحًا.',
  QUESTION_PAUSED: 'أوقف المقدم المسابقة مؤقتًا، فلم تُرسل إجابتك. حاول مرة أخرى عند الاستئناف.',
  QUESTION_NOT_STARTED: 'تفتح الإجابات عند بدء المؤقت.',
  DEADLINE_PASSED: 'انتهى الوقت قبل وصول إجابتك.',
  INVALID_OPTION: 'اختر إحدى الإجابات الأربع.',
  ADMIN_AUTH_REQUIRED: 'انتهت صلاحية دخولك كمقدم. سجل الدخول مرة أخرى.',
  INVALID_PASSCODE: 'رمز المرور غير صحيح.',
  TOO_MANY_ATTEMPTS: 'محاولات خاطئة كثيرة من هذه الشبكة. انتظر 15 دقيقة ثم حاول مرة أخرى.',
  ADMIN_NOT_CONFIGURED: 'لم يُضبط رمز مرور المقدم بعد. راجع قسم ضبط رمز المرور في ملف README.',
  PASSCODE_TOO_SHORT: 'يجب أن يكون رمز المرور الجديد من 10 إلى 72 حرفًا.',
  BANK_NOT_READY: 'يحتاج بنك الأسئلة إلى 4 فصول في كل منها 5 أسئلة قبل إنشاء جلسة.',
  QUESTION_IN_PROGRESS: 'اكشف إجابة السؤال الحالي أولًا.',
  CHAPTER_COMPLETED: 'انتهى هذا الفصل. أعد تعيينه إذا أردت لعبه مرة أخرى.',
  CHAPTER_NOT_FOUND: 'هذا الفصل ليس ضمن هذه الجلسة.',
  CHAPTER_NOT_FINISHED: 'بعض أسئلة هذا الفصل لم تُعرض بعد.',
  NO_ACTIVE_CHAPTER: 'ابدأ فصلًا أولًا.',
  NO_MORE_QUESTIONS: 'عُرضت كل أسئلة هذا الفصل.',
  INVALID_PHASE: 'هذه الخطوة لم تعد متاحة، وتم تحديث لوحة التحكم.',
  CONFIRMATION_REQUIRED: 'اكتب كلمة التأكيد للمتابعة.',
  SESSION_NOT_FOUND_OR_ENDED: 'انتهت هذه الجلسة.',
  TITLE_TOO_LONG: 'استخدم 120 حرفًا أو أقل لعنوان الجلسة.',
  UNKNOWN: 'حدث خطأ ما. حاول مرة أخرى.',
};

export class QuizError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || detail || code || 'حدث خطأ ما.');
    this.name = 'QuizError';
    this.code = code;
    this.detail = detail;
  }
}

const NETWORK_PATTERN = /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i;

export function fromSupabaseError(error) {
  const raw = String(error?.message || '');
  if ((!error?.code || error.code === '') && NETWORK_PATTERN.test(raw)) {
    return new QuizError('NETWORK', raw);
  }
  // Codes can carry detail after a colon, e.g. "BANK_INVALID:chapter 2 must have exactly 5 questions".
  const idx = raw.indexOf(':');
  const head = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const tail = idx === -1 ? '' : raw.slice(idx + 1).trim();
  // The database explains import problems in English; the technical detail is kept after an Arabic lead-in.
  if (head === 'BANK_INVALID') return new QuizError('BANK_INVALID', `لم يُستورد بنك الأسئلة. التفاصيل: ${tail}`);
  if (head === 'INVALID_SETTING') return new QuizError('INVALID_SETTING', `قيمة الإعداد غير مسموح بها (${tail}).`);
  if (/^[A-Z_]+$/.test(head)) return new QuizError(head, tail || undefined);
  return new QuizError('UNKNOWN');
}

export function messageFor(err) {
  if (!err) return '';
  if (err instanceof QuizError) return err.message;
  return String(err.message || err);
}
