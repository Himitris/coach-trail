import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme';
import { api } from '../api';
import { formatDuration, polarisationStatus } from '../utils/zones';
import VolumeChart from '../components/charts/VolumeChart';
import LongRunChart from '../components/charts/LongRunChart';
import HrEffortChart from '../components/charts/HrEffortChart';

const TABS = ['Semaines', 'Mois', '3 mois'];
// Fenêtre temporelle (en jours) appliquée aux graphiques sorties longues / FC selon l'onglet
const RANGE_DAYS = [12 * 7, 6 * 30, 3 * 30];

export default function StatsScreen() {
  const [tab, setTab] = useState(0);
  const [weekly, setWeekly] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [longRuns, setLongRuns] = useState([]);
  const [effortRuns, setEffortRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const [w, m, lr, runsResp] = await Promise.all([
        api.statsWeekly(),
        api.statsMonthly(),
        api.longRuns(),
        api.activities({ type: 'running', limit: 200 }),
      ]);
      setWeekly(w.slice(-16).reverse());
      setMonthly(m.slice(-9).reverse());
      setLongRuns(lr.reverse());

      // Sorties "running" de ~40-50 min avec FC, pour le suivi à effort constant
      const candidates = (runsResp.activities || [])
        .filter(a => a.duration_seconds >= 2300 && a.duration_seconds <= 3100 && a.avg_hr)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      setEffortRuns(candidates);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }

  // Onglet "3 mois" : zoom sur les ~13 dernières semaines des données hebdomadaires
  const volumeData = tab === 1 ? monthly : weekly.slice(tab === 2 ? -13 : -12);
  const labelKey = tab === 1 ? 'month' : 'week';
  const data = tab === 1 ? monthly : weekly.slice(-12);

  const cutoff = new Date(Date.now() - RANGE_DAYS[tab] * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const longRunsInRange = longRuns.filter(r => r.date >= cutoffStr);
  const effortRunsInRange = effortRuns.filter(r => r.date >= cutoffStr);

  // Max durée pour l'échelle des barres
  const maxDuration = Math.max(...data.map(d => d.duration_seconds), 1);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />
      }
    >
      {/* Toggle semaine / mois */}
      <View style={styles.tabs}>
        {TABS.map((t, i) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === i && styles.tabActive]}
            onPress={() => setTab(i)}
          >
            <Text style={[styles.tabText, tab === i && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Graphique de progression du volume */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartCard}>
        <VolumeChart data={volumeData} labelKey={labelKey} />
      </ScrollView>

      {/* Progression des sorties longues vs cible du plan */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartCard}>
        <LongRunChart runs={longRunsInRange} />
      </ScrollView>

      {/* FC moyenne à effort constant */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartCard}>
        <HrEffortChart runs={effortRunsInRange} />
      </ScrollView>

      {/* Volume + zones par période */}
      {data.map(period => {
        const pol = polarisationStatus(period.zone_percent);
        return (
          <View key={period[labelKey]} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.periodLabel}>{period[labelKey]}</Text>
              <Text style={styles.periodSessions}>{period.sessions} séances</Text>
            </View>

            {/* Barre de volume */}
            <View style={styles.volumeRow}>
              <Text style={styles.volumeText}>{formatDuration(period.duration_seconds)}</Text>
              <View style={styles.volumeBarBg}>
                <View
                  style={[
                    styles.volumeBarFill,
                    { width: `${(period.duration_seconds / maxDuration) * 100}%` },
                  ]}
                />
              </View>
            </View>

            {/* Indicateur polarisation */}
            <Text style={[styles.polText, { color: pol.ok ? colors.Z2 : colors.Z3 }]}>
              {pol.label}
            </Text>

            {/* Barre zones */}
            <View style={styles.zoneBar}>
              {['Z1','Z2','Z3','Z4','Z5'].map(z => {
                const pct = period.zone_percent[z] ?? 0;
                return pct > 0.5 ? (
                  <View key={z} style={[styles.zoneSeg, { flex: pct, backgroundColor: colors[z] }]} />
                ) : null;
              })}
            </View>
            <View style={styles.zoneLegend}>
              {['Z1','Z2','Z3','Z4','Z5'].map(z => (
                <Text key={z} style={[styles.zoneText, { color: colors[z] }]}>
                  {(period.zone_percent[z] ?? 0).toFixed(0)}%
                </Text>
              ))}
            </View>
          </View>
        );
      })}

      {/* Sorties longues */}
      {longRuns.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Sorties longues (≥ 1h30)</Text>
          {longRuns.map(run => (
            <View key={run.id} style={styles.longRunRow}>
              <View>
                <Text style={styles.longRunDate}>{run.date}</Text>
                <Text style={styles.longRunMeta}>
                  {(run.distance_meters / 1000).toFixed(1)}km
                  {run.elevation_gain ? `  D+ ${Math.round(run.elevation_gain)}m` : ''}
                </Text>
              </View>
              <View style={styles.longRunRight}>
                <Text style={styles.longRunDuration}>{formatDuration(run.duration_seconds)}</Text>
                {run.avg_hr && (
                  <Text style={styles.longRunHR}>♥ {run.avg_hr}</Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: colors.bg },

  chartCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
  },

  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 8,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  periodLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  periodSessions: { color: colors.textMuted, fontSize: 13 },

  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeText: { color: colors.accent, fontSize: 15, fontWeight: '700', width: 60 },
  volumeBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: '#2A2A2A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  volumeBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },

  polText: { fontSize: 12, fontWeight: '600' },

  zoneBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    gap: 1,
  },
  zoneSeg: { height: '100%' },
  zoneLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  zoneText: { fontSize: 11, fontWeight: '600' },

  longRunRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  longRunDate: { color: colors.text, fontSize: 14, fontWeight: '600' },
  longRunMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  longRunRight: { alignItems: 'flex-end' },
  longRunDuration: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  longRunHR: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
