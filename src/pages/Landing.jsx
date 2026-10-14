import { NpsScale } from '../components/ui';

export default function Landing({ notFound = false }) {
  return (
    <main className="landing">
      <div className="landing__inner">
        {notFound && (
          <p className="notice notice--info" role="status">
            That page does not exist. Pick an option below.
          </p>
        )}
        <NpsScale />
        <h1 className="landing__title">NPS Live Quiz</h1>
        <p className="landing__lead">
          Four chapters from the service advisor NPS orientation. Five questions each, 20 seconds per question.
          Answer fast and right to climb the leaderboard.
        </p>
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
            <strong>Scan the code</strong> on the big screen with your phone camera.
          </li>
          <li>
            <strong>Enter your name.</strong> No account or password needed.
          </li>
          <li>
            <strong>Tap your answer</strong> before the timer runs out. Faster correct answers score more.
          </li>
        </ol>
      </div>
    </main>
  );
}
