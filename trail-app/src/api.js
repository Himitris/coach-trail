import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const DEFAULT_URL = 'http://192.168.1.204:8000';
const STORAGE_KEY = 'api_base_url';

let baseURL = DEFAULT_URL;

export async function loadBaseURL() {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  if (saved) baseURL = saved;
  return baseURL;
}

export async function saveBaseURL(url) {
  baseURL = url.replace(/\/$/, '');
  await AsyncStorage.setItem(STORAGE_KEY, baseURL);
}

export function getBaseURL() {
  return baseURL;
}

function client() {
  return axios.create({ baseURL, timeout: 10000 });
}

export const api = {
  health: () => client().get('/health').then(r => r.data),

  activities: (params = {}) =>
    client().get('/activities', { params }).then(r => r.data),

  activity: (id) =>
    client().get(`/activities/${id}`).then(r => r.data),

  statsWeekly: (fromDate) =>
    client().get('/stats/weekly', { params: fromDate ? { from_date: fromDate } : {} }).then(r => r.data),

  statsMonthly: () =>
    client().get('/stats/monthly').then(r => r.data),

  statsZones: (fromDate, toDate) =>
    client().get('/stats/zones', {
      params: {
        ...(fromDate ? { from_date: fromDate } : {}),
        ...(toDate ? { to_date: toDate } : {}),
      },
    }).then(r => r.data),

  longRuns: () =>
    client().get('/stats/long_runs').then(r => r.data),
};
