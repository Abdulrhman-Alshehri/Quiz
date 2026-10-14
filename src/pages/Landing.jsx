import { BluePage } from '../components/Brand';
import { NpsScale } from '../components/ui';

// Start page in the style of the deck's title slide.
export default function Landing({ notFound = false }) {
  return (
    <BluePage className="landing">
      {notFound && (
        <p className="notice notice--info" role="status">
          That page does not exist. Pick an option below.
        </p>
      )}
      <h1 className="landing__title">NPS Live Quiz</h1>
      <p className="landing__sub">Customer Data, Voice and Action</p>
      <p className="landing__meta">Service advisor NPS orientation | Four chapters, five questions each</p>
      <NpsScale />
      <div className="landing__actions">
        <a className="btn btn--primary btn--xl" href="#/join">
          Join the quiz
        </a>
        <a className="btn btn--outline btn--xl" href="#/admin">
          Presenter console
        </a>
      </div>
      <ol className="landing__how">
        <li>
          <span className="step-num" aria-hidden="true">1</span>
          <span>
            <strong>Scan the QR code</strong> on the big screen with your phone camera.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">2</span>
          <span>
            <strong>Enter your name.</strong> No account or password needed.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">3</span>
          <span>
            <strong>Tap your answer</strong> before the timer runs out. Faster correct answers score more.
          </span>
        </li>
      </ol>
    </BluePage>
  );
}
