'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminOverview, AdminUser, AdminGarment, AdminOutfit, ApiError, clearToken, getProfile, getAdminOverview, getAdminUsers, getAdminWardrobe, getAdminOutfits, mediaUrl } from '../../lib/api';
import { FIT_LABELS, GARMENT_LABELS, colorById } from '../../lib/labels';
import type { FitTag, GarmentType } from '../../lib/api';
import RecommendationBench from './RecommendationBench';

type Section = 'overview' | 'users' | 'wardrobe' | 'outfits' | 'recommendations';
const SECTIONS: { id: Section; label: string; description: string }[] = [
  { id: 'overview', label: 'Обзор', description: 'Основные показатели и последние регистрации' },
  { id: 'users', label: 'Пользователи', description: 'Аккаунты, роли и активность пользователей' },
  { id: 'wardrobe', label: 'Гардероб', description: 'Вещи, добавленные пользователями FitCast' },
  { id: 'outfits', label: 'Образы', description: 'Сохранённые образы и их состав' },
  { id: 'recommendations', label: 'Тест рекомендаций', description: 'Запрос к сервису рекомендаций по гардеробу выбранного пользователя' },
];

function Icon({ name }: { name: Section | 'logout' | 'arrow' | 'refresh' | 'search' }) {
  const paths: Record<typeof name, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
    wardrobe: <path d="m8 3-5 3-2 5 4 2 1-3v11h12V10l1 3 4-2-2-5-5-3a4 4 0 0 1-8 0Z" />,
    outfits: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m3 9 9 5 9-5M12 14v7" /></>,
    recommendations: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M7 15h10" /></>,
    logout: <><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" /></>,
    arrow: <path d="M19 12H5m6-6-6 6 6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const date = (value: string) => new Date(value).toLocaleDateString('ru-RU');
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();

export default function AdminPage() {
  const router = useRouter();
  const [section, setSection] = useState<Section>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [wardrobe, setWardrobe] = useState<AdminGarment[]>([]);
  const [outfits, setOutfits] = useState<AdminOutfit[]>([]);
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const current = SECTIONS.find((item) => item.id === section)!;

  useEffect(() => {
    let active = true;
    getProfile().then((profile) => { if (active) setEmail(profile.email); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setOverview(null);
    setUsers([]); setWardrobe([]); setOutfits([]);
    async function load() {
      if (section === 'overview') {
        const [summary, accounts] = await Promise.all([getAdminOverview(controller.signal), getAdminUsers(controller.signal)]);
        if (!controller.signal.aborted) { setOverview(summary); setUsers(accounts); }
      } else if (section === 'users' || section === 'recommendations') {
        const accounts = await getAdminUsers(controller.signal);
        if (!controller.signal.aborted) setUsers(accounts);
      } else if (section === 'wardrobe') {
        const items = await getAdminWardrobe(controller.signal);
        if (!controller.signal.aborted) setWardrobe(items);
      } else {
        const items = await getAdminOutfits(controller.signal);
        if (!controller.signal.aborted) setOutfits(items);
      }
    }
    load().catch((err: unknown) => {
      if (!controller.signal.aborted) setError({ message: err instanceof Error ? err.message : 'Не удалось загрузить данные.', status: err instanceof ApiError ? err.status : undefined });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [section, attempt]);

  function changeSection(next: Section) { setSection(next); setQuery(''); }
  function logout() { clearToken(); router.push('/login'); }
  const search = query.trim().toLowerCase();
  const filteredUsers = users.filter((user) => user.email.toLowerCase().includes(search));
  const filteredWardrobe = wardrobe.filter((item) => `${item.user.email} ${item.type} ${item.dominantColor} ${item.fitTag}`.toLowerCase().includes(search));
  const filteredOutfits = outfits.filter((item) => `${item.name} ${item.user.email} ${item.eventType}`.toLowerCase().includes(search));

  function userTable(rows: AdminUser[]) {
    return <div className="dash-table-scroll"><table><caption className="dash-sr-only">Пользователи FitCast</caption>
      <thead><tr><th scope="col">Пользователь</th><th scope="col">Роль</th><th scope="col">Регистрация</th><th scope="col">Вещи</th><th scope="col">Образы</th></tr></thead>
      <tbody>{rows.length ? rows.map((user) => <tr key={user.id}>
        <td><div className="dash-person"><span className="dash-avatar">{user.email.slice(0, 1).toUpperCase()}</span><span>{user.email}</span></div></td>
        <td><span className={`dash-badge ${user.isAdmin ? 'is-admin' : ''}`}>{user.isAdmin ? 'Администратор' : 'Пользователь'}</span></td>
        <td>{date(user.createdAt)}</td><td>{user._count.wardrobeItems}</td><td>{user._count.savedOutfits}</td>
      </tr>) : <tr><td colSpan={5} className="dash-empty">{search ? 'По вашему запросу ничего не найдено.' : 'Пользователей пока нет.'}</td></tr>}</tbody>
    </table></div>;
  }

  return <div className="dash-shell">
    <aside className="dash-sidebar">
      <Link href="/admin" className="dash-brand">FitCast<span>ADMIN PANEL</span></Link>
      <div className="dash-nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Разделы админки">{SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => changeSection(item.id)}><Icon name={item.id} />{item.label}</button>)}</nav>
      <div className="dash-sidebar-bottom">
        <Link href="/"><Icon name="arrow" />Вернуться на сайт</Link>
        <button onClick={logout}><Icon name="logout" />Выйти из аккаунта</button>
        <div className="dash-sidebar-note">FitCast · Панель управления</div>
      </div>
    </aside>
    <div className="dash-workspace">
      <header className="dash-topbar"><span>Панель управления <span className="dash-slash">/</span> <strong>{current.label}</strong></span>
        <div className="dash-account"><span className="dash-avatar">{email ? email[0].toUpperCase() : 'A'}</span><div><strong>{email || 'Аккаунт'}</strong><small>Администрирование</small></div></div>
      </header>
      <main className="dash-content">
        <div className="dash-title-row"><div><h1>{current.label}</h1><p>{current.description}</p></div>
          <button className="dash-refresh" onClick={() => setAttempt((value) => value + 1)} disabled={loading}><Icon name="refresh" />Обновить</button></div>
        {loading && <div className="dash-loading" role="status">Загрузка данных…</div>}
        {error && <section className="dash-panel dash-error" role="alert"><h2>{error.status === 403 ? 'Доступ ограничен' : error.status === 401 ? 'Войдите в аккаунт' : 'Не удалось загрузить данные'}</h2><p>{error.message}</p>{error.status === 401 && <Link href="/login">Перейти ко входу →</Link>}{error.status !== 401 && error.status !== 403 && <button className="dash-refresh" onClick={() => setAttempt((value) => value + 1)}>Повторить</button>}</section>}
        {!loading && !error && <>
          {section === 'overview' && overview && <section className="dash-stats" aria-label="Статистика">{([
            ['users', 'Пользователи', overview.users, 'Зарегистрировано аккаунтов'],
            ['wardrobe', 'Вещи в гардеробе', overview.wardrobeItems, 'Добавлено пользователями'],
            ['outfits', 'Сохранённые образы', overview.savedOutfits, 'Собрано в приложении'],
          ] as const).map(([id, title, count, hint]) => <button key={id} className="dash-stat" onClick={() => changeSection(id)}><span className="dash-stat-top">{title}<span className={`dash-stat-icon ${id}`}><Icon name={id} /></span></span><strong>{count.toLocaleString('ru-RU')}</strong><span className="dash-stat-hint">{hint}</span></button>)}</section>}
          {section === 'recommendations' && <RecommendationBench users={users} />}
          {section !== 'recommendations' && <section className="dash-panel">
            <div className="dash-panel-heading"><div><h2>{section === 'overview' ? 'Последние пользователи' : current.label}</h2><p>{section === 'overview' ? 'Последние 5 зарегистрированных аккаунтов' : 'Последние 100 записей · Режим просмотра'}</p></div>
              {section === 'overview' ? <button className="dash-text-button" onClick={() => changeSection('users')}>Все пользователи →</button> : <label className="dash-search"><Icon name="search" /><input aria-label="Поиск в текущем списке" placeholder="Поиск в списке…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
            </div>
            {(section === 'overview' || section === 'users') && userTable(section === 'overview' ? users.slice(0, 5) : filteredUsers)}
            {section === 'wardrobe' && <div className="dash-table-scroll"><table><caption className="dash-sr-only">Вещи пользователей</caption><thead><tr><th scope="col">Тип</th><th scope="col">Владелец</th><th scope="col">Цвет</th><th scope="col">Посадка</th><th scope="col">Добавлено</th></tr></thead><tbody>{filteredWardrobe.length ? filteredWardrobe.map((item) => <tr key={item.id}><td><div className="dash-person">{/* eslint-disable-next-line @next/next/no-img-element -- API upload */}<img className="dash-thumb" src={mediaUrl(item.imageUrl)} alt="" loading="lazy" /><span>{GARMENT_LABELS[item.type as GarmentType] ?? label(item.type)}</span></div></td><td>{item.user.email}</td><td><span className="dash-color"><i style={{ background: colorById(item.dominantColor)?.hex ?? '#ccc' }} aria-hidden />{colorById(item.dominantColor)?.label ?? item.dominantColor}</span></td><td>{FIT_LABELS[item.fitTag as FitTag] ?? label(item.fitTag)}</td><td>{date(item.createdAt)}</td></tr>) : <tr><td colSpan={5} className="dash-empty"><Icon name="wardrobe" /><strong>{search ? 'Ничего не найдено' : 'Гардероб пока пуст'}</strong><span>{search ? 'Попробуйте другой запрос.' : 'Здесь появятся вещи, добавленные пользователями.'}</span></td></tr>}</tbody></table></div>}
            {section === 'outfits' && <div className="dash-table-scroll"><table><caption className="dash-sr-only">Сохранённые образы</caption><thead><tr><th scope="col">Название</th><th scope="col">Владелец</th><th scope="col">Событие</th><th scope="col">Вещи</th><th scope="col">Создано</th></tr></thead><tbody>{filteredOutfits.length ? filteredOutfits.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.user.email}</td><td className="dash-capitalize">{label(item.eventType)}</td><td>{item._count.items}</td><td>{date(item.createdAt)}</td></tr>) : <tr><td colSpan={5} className="dash-empty"><Icon name="outfits" /><strong>{search ? 'Ничего не найдено' : 'Образов пока нет'}</strong><span>{search ? 'Попробуйте другой запрос.' : 'Здесь появятся сохранённые образы пользователей.'}</span></td></tr>}</tbody></table></div>}
          </section>}
          <p className="dash-footnote">Данные FitCast · Доступ только для администраторов</p>
        </>}
      </main>
    </div>
  </div>;
}
