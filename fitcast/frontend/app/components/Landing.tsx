import Image from 'next/image';
import Link from 'next/link';

const FEATURES = [
  {
    title: 'Photo → 3D garment',
    image: '/images/landing/feature-scan-v2.jpg',
    alt: 'Photo of a striped T-shirt, the garment cut out by its mask, and its 3D model',
    text:
      'Snap a photo of a garment laid flat. FitCast detects the clothing type, separates it from the background ' +
      'and maps the fabric pattern onto a 3D pattern. You can fine-tune every step by hand: mask, points, color.',
  },
  {
    title: 'A model shaped like you',
    image: '/images/landing/feature-bodies-v3.jpg',
    alt: 'The same model in three body shapes: slim, regular and full',
    text:
      'Clothes go on a neutral mannequin, not on a photo of you. Height, shoulders, chest, waist and hips ' +
      'are adjustable with sliders, so you can see how a piece sits on a similar figure.',
  },
  {
    title: 'Outfit of the day',
    image: '/images/landing/feature-outfit-v3.jpg',
    alt: 'A dressed 3D model in three-quarter view',
    text:
      'Mark how each piece fits: just right, tight or loose. FitCast builds an outfit for the weather ' +
      'and the occasion (class, gym, a meeting) and skips anything that doesn\'t fit or clashes.',
  },
];

const STEPS = [
  ['01', 'Photograph a garment', 'One item per photo, shot from above on a plain background.'],
  ['02', 'Check the detection', 'Confirm or correct the type, color and fit.'],
  ['03', 'Try it on the mannequin', 'A 3D garment with your texture on an adjustable figure.'],
  ['04', 'Get an outfit', 'A look from your own wardrobe for the weather and occasion.'],
] as const;

export default function Landing() {
  return (
    <>
      <main className="landing-main">
        <section className="landing-text">
          <span className="landing-kicker">DIGITAL WARDROBE</span>
          <h1>Your clothes in 3D from a single photo</h1>
          <p className="dropcap">
            How much of your closet do you actually wear? FitCast builds a digital wardrobe from photos of
            your real clothes. Take a picture and the app detects the type and color, builds a 3D copy with
            the fabric pattern and shows it on a mannequin. Mark how each piece fits, and FitCast picks an
            outfit for today's weather and occasion.
          </p>
          <div className="landing-actions">
            <Link href="/register" className="landing-cta">
              Get started free →
            </Link>
            <Link href="/login" className="landing-secondary">
              I already have an account
            </Link>
          </div>
        </section>

        <figure className="landing-figure">
          <span className="fig-label fig-label-left">FIG_001</span>
          <span className="fig-label fig-label-right">[ Photo → 3D ]</span>
          <Image
            src="/images/landing/hero-photo-to-3d-v2.jpg"
            alt="Left: a photo of a T-shirt on a bed. Right: its 3D model with the transferred pattern"
            width={1280}
            height={860}
            priority
            sizes="(max-width: 900px) 100vw, 50vw"
            className="landing-photo"
          />
          <figcaption className="landing-caption">A real photo and the 3D garment FitCast built from it.</figcaption>
        </figure>
      </main>

      <section className="landing-features">
        <div className="features-head">
          <span className="features-rule" aria-hidden />
          <h2>What FitCast does</h2>
          <span className="features-rule" aria-hidden />
        </div>

        <div className="features-grid">
          {FEATURES.map((feature, i) => (
            <article key={feature.title} className="feature">
              <h3>
                {String(i + 1).padStart(2, '0')}. {feature.title}
              </h3>
              <figure className="feature-figure">
                <span className="fig-label fig-label-left">FIG_{String(i + 2).padStart(3, '0')}</span>
                <div className="feature-photo">
                  <Image src={feature.image} alt={feature.alt} fill sizes="(max-width: 900px) 100vw, 33vw" />
                </div>
              </figure>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-steps" aria-labelledby="steps-title">
        <div className="features-head">
          <span className="features-rule" aria-hidden />
          <h2 id="steps-title">How it works</h2>
          <span className="features-rule" aria-hidden />
        </div>
        <ol className="steps-grid">
          {STEPS.map(([n, title, text]) => (
            <li key={n}>
              <span>{n}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="landing-bottom-cta">
          <p>Start with a single item. It only takes a couple of minutes.</p>
          <Link href="/register" className="landing-cta">
            Create your wardrobe →
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} FitCast</span>
        <span>[ Clothing photo → outfit of the day ]</span>
      </footer>
    </>
  );
}
