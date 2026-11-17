'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  AdminUser, ApiError, EventType, Precipitation, RecommendationTestResult, runRecommendationTest,
} from '../../lib/api';
import { EVENT_LABELS, PRECIPITATION_LABELS } from '../../lib/labels';

/**
 * Test bench for the recommendation service. It only builds the contract request from a
 * user's wardrobe and shows what the service answers; the algorithm is not part of this page.
 */
export default function RecommendationBench({ users }: { users: AdminUser[] }) {
  const candidates = users.filter((u) => u._count.wardrobeItems > 0);
  const [userId, setUserId] = useState('');
  const [temperatureC, setTemperature] = useState(12);
  const [precipitation, setPrecipitation] = useState<Precipitation>('NONE');
  const [eventType, setEventType] = useState<EventType>('CASUAL');
  const [limit, setLimit] = useState(3);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RecommendationTestResult | null>(null);

  useEffect(() => {
    if (!userId && candidates[0]) setUserId(candidates[0].id);
  }, [userId, candidates]);

  async function run(event: FormEvent) {
    event.preventDefault();
    setRunning(true); setError(''); setResult(null);
    try {
      setResult(await runRecommendationTest({ userId, temperatureC, precipitation, eventType, limit }));
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Не удалось выполнить тест.');
    } finally { setRunning(false); }
  }

  const status = result?.service?.status;
  return (
    <div className="bench">
      <section className="dash-panel bench-form-panel">
        <div className="dash-panel-heading"><div><h2>Параметры запроса</h2><p>Запрос собирается по контракту recommendation-service: только метаданные вещей, без фото и email.</p></div></div>
        <form className="bench-form" onSubmit={run}>
          <label>Пользователь
            <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              {!candidates.length && <option value="">Нет пользователей с вещами</option>}
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.email} · вещей: {u._count.wardrobeItems}</option>)}
            </select>
          </label>
          <label>Температура, °C
            <input type="number" min={-90} max={60} step={1} value={temperatureC} onChange={(e) => setTemperature(Number(e.target.value))} required />
          </label>
          <label>Осадки
            <select value={precipitation} onChange={(e) => setPrecipitation(e.target.value as Precipitation)}>
              {(Object.keys(PRECIPITATION_LABELS) as Precipitation[]).map((p) => <option key={p} value={p}>{PRECIPITATION_LABELS[p]}</option>)}
            </select>
          </label>
          <label>Событие
            <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
              {(Object.keys(EVENT_LABELS) as EventType[]).map((p) => <option key={p} value={p}>{EVENT_LABELS[p]}</option>)}
            </select>
          </label>
          <label>Образов, не больше
            <input type="number" min={1} max={5} value={limit} onChange={(e) => setLimit(Number(e.target.value))} required />
          </label>
          <button className="bench-run" disabled={running || !userId}>{running ? 'Выполняется…' : 'Запустить тест'}</button>
        </form>
      </section>

      {error && <section className="dash-panel dash-error" role="alert"><h2>Тест не выполнен</h2><p>{error}</p></section>}

      {result && (
        <div className="bench-results">
          <section className="dash-panel">
            <div className="dash-panel-heading"><div><h2>Ответ сервиса</h2>
              <p>{result.service ? `${result.service.url} · ${result.service.ms} мс` : 'RECOMMENDATION_SERVICE_URL не задан в .env бэкенда — запрос не отправлялся.'}</p></div>
              {result.service && <span className={`dash-badge ${status === 200 ? 'is-ok' : 'is-warn'}`}>{status === 0 ? 'нет связи' : `HTTP ${status}`}</span>}
            </div>
            {result.service && status === 501 && <p className="bench-note">Сервис отвечает 501: алгоритм рекомендаций ещё не подключён. Запрос принят по контракту — это ожидаемо.</p>}
            <pre className="bench-json">{JSON.stringify(result.service?.body ?? null, null, 2)}</pre>
          </section>
          <section className="dash-panel">
            <div className="dash-panel-heading"><div><h2>Отправленный запрос</h2><p>POST /recommendations</p></div></div>
            <pre className="bench-json">{JSON.stringify(result.payload, null, 2)}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
