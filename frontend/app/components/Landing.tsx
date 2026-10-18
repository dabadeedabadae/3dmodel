import Image from 'next/image';
import Link from 'next/link';

const FEATURES = [
  {
    title: 'Digitise your wardrobe',
    image: '/images/landing/preview.jpg',
    text:
      'Take a photo of each item, one at a time. FitCast recognises the type of garment — t-shirt, jacket, ' +
      'trousers — and its dominant colour, then places it on a neutral preset body model instead of a flat list ' +
      'of pictures. We photograph your clothes, not you.',
  },
  {
    title: 'Dress for the day',
    image: '/images/landing/preview.jpg',
    text:
      'FitCast checks the current weather and asks where you are going — the gym, a business meeting or just ' +
      'a casual day out. The outfit builder combines your items for that context, so a cold rainy morning and a ' +
      'warm evening get different looks.',
  },
  {
    title: 'Skip what doesn’t work',
    image: '/images/landing/preview.jpg',
    text:
      'Tag how every piece fits: fits well, too tight or too loose. Items that don’t fit are left out of ' +
      'suggestions, and the colour check warns you when the pieces you picked clash with each other.',
  },
];

export default function Landing() {
  return (
    <>
      <main className="landing-main">
        <section className="landing-text">
          <h1>The wardrobe of your dreams</h1>
          <p className="dropcap">
            Ever wondered how many of the clothes in your closet you actually wear? FitCast builds a digital
            wardrobe from photos of your real clothes. Snap your items one at a time and it recognises the type of
            each garment and its dominant colour. Tag how every piece fits, and FitCast puts together outfits for
            today&apos;s weather and the occasion, leaving out anything that doesn&apos;t fit or clashes in colour.
          </p>
          <Link href="/register" className="landing-cta">
            Get started →
          </Link>
        </section>

        <figure className="landing-figure">
          <span className="fig-label fig-label-left">FIG_001</span>
          <span className="fig-label fig-label-right">[ Preview ]</span>
          <Image
            src="/images/landing/preview.jpg"
            alt="FitCast app preview"
            width={640}
            height={480}
            priority
            className="landing-photo"
          />
        </figure>
      </main>

      <section className="landing-features">
        <div className="features-head">
          <span className="features-rule" aria-hidden />
          <h2>With FitCast, you can</h2>
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
                  <Image src={feature.image} alt={feature.title} fill sizes="(max-width: 900px) 100vw, 33vw" />
                </div>
              </figure>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} FitCast</span>
        <span>[ Photos of clothes → outfit of the day ]</span>
      </footer>
    </>
  );
}
