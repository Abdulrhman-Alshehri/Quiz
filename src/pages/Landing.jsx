import { BluePage } from '../components/Brand';
import { NpsScale } from '../components/ui';

// Start page in the style of the deck's title slide.
export default function Landing({ notFound = false }) {
  return (
    <BluePage className="landing">
      {notFound && (
        <p className="notice notice--info" role="status">
          هذه الصفحة غير موجودة. اختر أحد الخيارات أدناه.
        </p>
      )}
      <h1 className="landing__title">مسابقة NPS المباشرة</h1>
      <p className="landing__sub">بيانات العميل وصوته والعمل عليه</p>
      <p className="landing__meta">ورشة تعريف مستشاري الخدمة بمؤشر NPS | أربعة فصول، خمسة أسئلة لكل فصل</p>
      <NpsScale />
      <div className="landing__actions">
        <a className="btn btn--primary btn--xl" href="#/join">
          انضم إلى المسابقة
        </a>
        <a className="btn btn--outline btn--xl" href="#/admin">
          لوحة تحكم المقدم
        </a>
      </div>
      <ol className="landing__how">
        <li>
          <span className="step-num" aria-hidden="true">1</span>
          <span>
            <strong>امسح رمز QR</strong> المعروض على الشاشة الكبيرة بكاميرا جوالك.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">2</span>
          <span>
            <strong>اكتب اسمك.</strong> لا حاجة إلى حساب أو كلمة مرور.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">3</span>
          <span>
            <strong>اختر إجابتك</strong> قبل انتهاء الوقت. الإجابة الصحيحة الأسرع تكسب نقاطًا أكثر.
          </span>
        </li>
      </ol>
    </BluePage>
  );
}
