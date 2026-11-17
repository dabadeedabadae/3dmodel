import Image from 'next/image';
import Link from 'next/link';

const FEATURES = [
  {
    title: 'Фото → 3D-вещь',
    image: '/images/landing/feature-scan-v2.jpg',
    alt: 'Фото полосатой футболки, вырезанная по маске вещь и её 3D-модель',
    text:
      'Сфотографируйте вещь на ровной поверхности. FitCast определяет тип одежды, отделяет её от фона ' +
      'и переносит рисунок ткани на 3D-выкройку. Каждый шаг можно поправить вручную: маску, точки, цвет.',
  },
  {
    title: 'Модель под вашу фигуру',
    image: '/images/landing/feature-bodies-v3.jpg',
    alt: 'Одна и та же модель в трёх вариантах фигуры: стройная, базовая и плотная',
    text:
      'Вещи надеваются не на ваше фото, а на нейтральный манекен. Рост, плечи, грудь, талия и бёдра ' +
      'настраиваются ползунками — так видно, как вещь сядет на похожую фигуру.',
  },
  {
    title: 'Образ на день',
    image: '/images/landing/feature-outfit-v3.jpg',
    alt: 'Одетая 3D-модель в ракурсе три четверти',
    text:
      'Отметьте, как сидит каждая вещь: хорошо, жмёт или великовато. FitCast соберёт образ под погоду ' +
      'и повод — учёба, спортзал, встреча — и не предложит то, что не подходит по посадке или цвету.',
  },
];

const STEPS = [
  ['01', 'Снимите вещь', 'Одна вещь — одно фото, сверху, на ровном фоне.'],
  ['02', 'Проверьте распознавание', 'Тип, цвет и посадку можно подтвердить или исправить.'],
  ['03', 'Примерьте на манекене', '3D-вещь с вашей текстурой на настраиваемой фигуре.'],
  ['04', 'Получите образ', 'Комплект из вашего гардероба под погоду и событие.'],
] as const;

export default function Landing() {
  return (
    <>
      <main className="landing-main">
        <section className="landing-text">
          <span className="landing-kicker">ЦИФРОВОЙ ГАРДЕРОБ</span>
          <h1>Ваша одежда в 3D — по одной фотографии</h1>
          <p className="dropcap">
            Сколько вещей из шкафа вы на самом деле носите? FitCast собирает цифровой гардероб из фотографий
            вашей настоящей одежды. Снимите вещь — приложение определит её тип и цвет, построит 3D-копию с
            рисунком ткани и покажет её на манекене. Отметьте, как сидит каждая вещь, и FitCast подберёт
            образ под сегодняшнюю погоду и повод.
          </p>
          <div className="landing-actions">
            <Link href="/register" className="landing-cta">
              Начать бесплатно →
            </Link>
            <Link href="/login" className="landing-secondary">
              У меня есть аккаунт
            </Link>
          </div>
        </section>

        <figure className="landing-figure">
          <span className="fig-label fig-label-left">FIG_001</span>
          <span className="fig-label fig-label-right">[ Фото → 3D ]</span>
          <Image
            src="/images/landing/hero-photo-to-3d-v2.jpg"
            alt="Слева — фото футболки на кровати, справа — её 3D-модель с перенесённым рисунком"
            width={1280}
            height={860}
            priority
            sizes="(max-width: 900px) 100vw, 50vw"
            className="landing-photo"
          />
          <figcaption className="landing-caption">Реальный снимок и 3D-вещь, построенная по нему в FitCast.</figcaption>
        </figure>
      </main>

      <section className="landing-features">
        <div className="features-head">
          <span className="features-rule" aria-hidden />
          <h2>Что умеет FitCast</h2>
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
          <h2 id="steps-title">Как это работает</h2>
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
          <p>Начните с одной вещи — это займёт пару минут.</p>
          <Link href="/register" className="landing-cta">
            Создать гардероб →
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} FitCast</span>
        <span>[ Фото одежды → образ дня ]</span>
      </footer>
    </>
  );
}
