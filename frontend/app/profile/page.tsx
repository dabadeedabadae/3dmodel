'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken } from '../../lib/api';
import { useProfile } from './use-profile';

export default function ProfilePage() {
  const router = useRouter();
  const { profile, loading, error, retry } = useProfile();
  return <main className="profile-main">
    <div className="profile-heading"><div><span className="profile-kicker">ВАШ FITCAST</span><h1>Личный кабинет</h1><p>Ваш гардероб, образы и всё, что нужно на каждый день.</p></div><Link className="account-settings-link" href="/profile/settings">⚙ Настройки</Link></div>
    {loading ? <p role="status" className="profile-loading">Загрузка…</p> : !profile ? <section className="profile-panel"><p role="alert">{error}</p><button className="secondary" onClick={retry}>Повторить</button></section> : <>
      <section className="profile-panel account-hero" aria-label="Карточка профиля"><div className="profile-avatar">{(profile.name || profile.email)[0].toUpperCase()}</div><div className="account-hero-info"><span className="profile-kicker">МОЙ ПРОФИЛЬ</span><h2>{profile.name || profile.email.split('@')[0]}</h2><p>{profile.email}</p><div className="account-meta"><span>{profile.city || 'Город не указан'}</span><span>С нами с {new Date(profile.createdAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</span></div></div><Link href="/profile/settings" className="account-edit">Редактировать профиль →</Link></section>
      <section className="profile-stats" aria-label="Мой гардероб"><article className="profile-panel"><span>ВЕЩИ В ГАРДЕРОБЕ</span><strong>{profile._count?.wardrobeItems ?? '—'}</strong><p>Ваши сохранённые вещи</p></article><article className="profile-panel"><span>СОХРАНЁННЫЕ ОБРАЗЫ</span><strong>{profile._count?.savedOutfits ?? '—'}</strong><p>Комплекты из вашего гардероба</p></article><Link href="/model" className="profile-panel profile-model-link"><span>ПРИМЕРОЧНАЯ</span><h2>Ваш следующий образ</h2><p>Попробуйте одежду на 3D-модели</p><b>Перейти к модели ↗</b></Link></section>
      {!profile._count && <p className="account-note">Статистика временно недоступна.</p>}
      <div className="account-bottom"><span>Имя, город, описание и пароль можно изменить в настройках.</span><button className="profile-logout" onClick={() => { clearToken(); router.replace('/login'); }}>Выйти из аккаунта ↗</button></div>
    </>}
  </main>;
}
