import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Weather from Open-Meteo (https://open-meteo.com): free, no API key, CC BY 4.0 data. Only the city name and its
 * coordinates leave the server; nothing about the user is sent. Responses are cached in memory, so a page full of
 * events in the same city costs one geocoding and one forecast request.
 */

/** The precipitation enum of the recommendation-service contract. */
export type Precipitation = 'NONE' | 'RAIN' | 'SNOW' | 'MIXED';

export interface WeatherLocation {
  name: string; country: string | null; latitude: number; longitude: number; timezone: string;
}
export interface DailyWeather {
  date: string; minC: number; maxC: number; weatherCode: number; precipitation: Precipitation;
  precipitationProbability: number | null; description: string;
}
export interface CurrentWeather {
  time: string; temperatureC: number; weatherCode: number; precipitation: Precipitation; description: string;
}
export interface Forecast {
  location: WeatherLocation;
  current: CurrentWeather;
  daily: DailyWeather[];
  /** hourly series in UTC milliseconds, used to find the weather at an event's time */
  hourly: { utcMs: number[]; temperatureC: number[]; weatherCode: number[] };
}

/** Weather at a point in time, already in the shape the recommendation contract expects. */
export type WeatherAt =
  | { status: 'FORECAST'; location: WeatherLocation; temperatureC: number; weatherCode: number;
      precipitation: Precipitation; description: string }
  | { status: 'PAST' | 'TOO_FAR'; location: WeatherLocation; forecastFrom?: string };

/** WMO weather interpretation codes (Open-Meteo `weather_code`) → contract precipitation. */
export function precipitationFromCode(code: number): Precipitation {
  if ([56, 57, 66, 67].includes(code)) return 'MIXED'; // freezing drizzle / freezing rain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'SNOW';
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82) || code >= 95) return 'RAIN';
  return 'NONE';
}

const DESCRIPTIONS: [number[], string][] = [
  [[0], 'Clear sky'], [[1], 'Mainly clear'], [[2], 'Partly cloudy'], [[3], 'Overcast'], [[45, 48], 'Fog'],
  [[51, 53, 55], 'Drizzle'], [[56, 57], 'Freezing drizzle'], [[61], 'Light rain'], [[63], 'Rain'], [[65], 'Heavy rain'],
  [[66, 67], 'Freezing rain'], [[71], 'Light snow'], [[73], 'Snow'], [[75], 'Heavy snow'], [[77], 'Snow grains'],
  [[80, 81], 'Rain showers'], [[82], 'Violent rain showers'], [[85, 86], 'Snow showers'], [[95], 'Thunderstorm'],
  [[96, 99], 'Thunderstorm with hail'],
];
export function describeCode(code: number): string {
  return DESCRIPTIONS.find(([codes]) => codes.includes(code))?.[1] ?? 'Unknown';
}

const GEO_TTL = 24 * 3600_000;
const GEO_MISS_TTL = 3600_000;
const FORECAST_TTL = 30 * 60_000;
const MAX_CACHE = 500;
const FORECAST_DAYS = 16;

class TtlCache<T> {
  private readonly map = new Map<string, { value: T; expires: number }>();
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) { this.map.delete(key); return undefined; }
    return hit.value;
  }
  set(key: string, value: T, ttl: number) {
    if (this.map.size >= MAX_CACHE) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { value, expires: Date.now() + ttl });
  }
}

@Injectable()
export class WeatherService {
  private readonly log = new Logger(WeatherService.name);
  private readonly geoCache = new TtlCache<WeatherLocation | null>();
  private readonly forecastCache = new TtlCache<Forecast>();
  private readonly geocodingUrl: string;
  private readonly forecastUrl: string;

  constructor(config: ConfigService) {
    this.geocodingUrl = config.get('OPEN_METEO_GEOCODING_URL') || 'https://geocoding-api.open-meteo.com/v1/search';
    this.forecastUrl = config.get('OPEN_METEO_FORECAST_URL') || 'https://api.open-meteo.com/v1/forecast';
  }

  private async getJson(url: string): Promise<any> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'FitCast/0.1' } });
    } catch (err) {
      this.log.warn(`weather request failed: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException('The weather service is unavailable right now. Try again later.');
    }
    if (!response.ok) {
      this.log.warn(`weather request answered ${response.status}`);
      throw new ServiceUnavailableException('The weather service is unavailable right now. Try again later.');
    }
    return response.json();
  }

  /** City name → coordinates. Returns null when the city is not found. */
  async geocode(city: string): Promise<WeatherLocation | null> {
    const key = city.trim().toLowerCase();
    const cached = this.geoCache.get(key);
    if (cached !== undefined) return cached;
    const params = new URLSearchParams({ name: city.trim(), count: '1', language: 'en', format: 'json' });
    const data = await this.getJson(`${this.geocodingUrl}?${params}`);
    const hit = Array.isArray(data?.results) ? data.results[0] : undefined;
    const location: WeatherLocation | null = hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)
      ? { name: String(hit.name), country: hit.country ? String(hit.country) : null,
          latitude: hit.latitude, longitude: hit.longitude, timezone: String(hit.timezone ?? 'UTC') }
      : null;
    this.geoCache.set(key, location, location ? GEO_TTL : GEO_MISS_TTL);
    return location;
  }

  /** Current weather, 16 days of daily forecast and the hourly series for a city. */
  async forecast(city: string): Promise<Forecast> {
    const location = await this.geocode(city);
    if (!location) throw new NotFoundException(`City "${city.trim()}" was not found.`);
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    const cached = this.forecastCache.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({
      latitude: String(location.latitude), longitude: String(location.longitude),
      current: 'temperature_2m,weather_code',
      hourly: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto', forecast_days: String(FORECAST_DAYS),
    });
    const data = await this.getJson(`${this.forecastUrl}?${params}`);
    const offsetMs = Number(data?.utc_offset_seconds ?? 0) * 1000;
    // Open-Meteo returns local wall-clock times without an offset ("2026-11-23T14:00") when timezone=auto
    const toUtc = (local: string) => Date.parse(`${local}Z`) - offsetMs;
    const round = (n: number) => Math.round(n * 10) / 10;
    try {
      const c = data.current, h = data.hourly, d = data.daily;
      const forecast: Forecast = {
        location,
        current: {
          time: new Date(toUtc(c.time)).toISOString(), temperatureC: round(c.temperature_2m),
          weatherCode: c.weather_code, precipitation: precipitationFromCode(c.weather_code),
          description: describeCode(c.weather_code),
        },
        daily: (d.time as string[]).map((date, i) => ({
          date, minC: round(d.temperature_2m_min[i]), maxC: round(d.temperature_2m_max[i]),
          weatherCode: d.weather_code[i], precipitation: precipitationFromCode(d.weather_code[i]),
          precipitationProbability: d.precipitation_probability_max?.[i] ?? null,
          description: describeCode(d.weather_code[i]),
        })),
        hourly: {
          utcMs: (h.time as string[]).map(toUtc),
          temperatureC: (h.temperature_2m as number[]).map(round),
          weatherCode: h.weather_code as number[],
        },
      };
      if (!Number.isFinite(forecast.current.temperatureC) || !forecast.hourly.utcMs.length) throw new Error('empty');
      this.forecastCache.set(key, forecast, FORECAST_TTL);
      return forecast;
    } catch {
      this.log.warn('weather response had an unexpected shape');
      throw new ServiceUnavailableException('The weather service returned an unexpected answer.');
    }
  }

  /** Weather in a city at a given moment: the nearest hour of the forecast, or why there is none. */
  async at(city: string, when: Date): Promise<WeatherAt> {
    const f = await this.forecast(city);
    const t = when.getTime(), { utcMs } = f.hourly;
    const hour = 3600_000;
    if (t < utcMs[0]! - hour) return { status: 'PAST', location: f.location };
    if (t > utcMs[utcMs.length - 1]! + hour) {
      // the forecast window moves forward every day; tell when this moment comes into it
      const forecastFrom = new Date(t - (FORECAST_DAYS - 1) * 24 * hour).toISOString().slice(0, 10);
      return { status: 'TOO_FAR', location: f.location, forecastFrom };
    }
    let best = 0;
    for (let i = 1; i < utcMs.length; i++) if (Math.abs(utcMs[i]! - t) < Math.abs(utcMs[best]! - t)) best = i;
    const code = f.hourly.weatherCode[best]!;
    return {
      status: 'FORECAST', location: f.location, temperatureC: f.hourly.temperatureC[best]!, weatherCode: code,
      precipitation: precipitationFromCode(code), description: describeCode(code),
    };
  }
}
