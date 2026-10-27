import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { differenceInDays, parseISO } from 'date-fns';
import { colors } from '../theme';
import { api } from '../api';
import { formatDuration, formatDistance, polarisationStatus } from '../utils/zones';

const RACE_DATE = '2026-11-08';
const RACE_LABEL = 'Trail 31km — 8 nov 2026';

export default function DashboardScreen() {
  const [weekData, setWeekData] = useState(null);
  const [lastActivity, setLastActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      // Semaine en cours (lundi)
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const fromDate = monday.toISOString().slice(0, 10);

      const [weekly, activitiesData] = await Promise.all([
        api.statsWeekly(fromDate),
        api.activities({ limit: 1 }),
      ]);

      setWeekData(weekly[weekly.length - 1] ?? null);
      setLastActivity(activitiesData.activities[0] ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  const daysToRace = differenceInDays(parseISO(RACE_DATE), new Date());
  const polStatus = weekData ? polarisationStatus(weekData.zone_percent) : null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      {/* Objectif course */}
      <View style={styles.raceCard}>
        <Text style={styles.raceLabel}>{RACE_LABEL}</Text>
        <Text style={styles.raceCountdown}>J–{daysToRace}</Text>
      </View>

      {/* Semaine en cours */}
      <Text style={styles.sectionTitle}>Cette semaine</Text>
      {weekData ? (
        <>
          <View style={styles.grid}>
            <StatCard
              label="Sessions"
              value={`${weekData.sessions}`}
              sub="séances"
            />
            <StatCard
              label="Volume"
              value={formatDuration(weekData.duration_seconds)}
              sub="temps total"
            />
            <StatCard
              label="Distance"
              value={formatDistance(weekData.distance_meters)}
              sub=""
            />
            <StatCard
              label="D+"
              value={`${Math.round(weekData.elevation_gain)}m`}
              sub="dénivelé"
            />
          </View>

          {/* Indicateur polarisation */}
          {polStatus && (
            <View style={[styles.polCard, polStatus.ok ? styles.polOk : styles.polWarn]}>
              <Text style={styles.polText}>{polStatus.label}</Text>
            </View>
          )}

          {/* Barres zones */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Répartition zones (semaine)</Text>
            <View style={styles.zoneBar}>
              {['Z1','Z2','Z3','Z4','Z5'].map(z => {
                const pct = weekData.zone_percent[z] ?? 0;
                return pct > 0 ? (
                  <View
                    key={z}
                    style={[styles.zoneSeg, { flex: pct, backgroundColor: colors[z] }]}
                  />
                ) : null;
              })}
            </View>
            <View style={styles.zoneLegend}>
              {['Z1','Z2','Z3','Z4','Z5'].map(z => (
                <Text key={z} style={[styles.zoneLegendText, { color: colors[z] }]}>
                  {z} {(weekData.zone_percent[z] ?? 0).toFixed(0)}%
                </Text>
              ))}
            </View>
          </View>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucune activité cette semaine</Text>
        </View>
      )}

      {/* Dernière activité */}
      {lastActivity && (
        <>
          <Text style={styles.sectionTitle}>Dernière activité</Text>
          <View style={styles.card}>
            <View style={styles.lastRow}>
              <Text style={styles.lastDate}>{lastActivity.date}</Text>
              <Text style={styles.lastType}>{lastActivity.type.replace('_', ' ')}</Text>
            </View>
            <View style={styles.lastStats}>
              <Text style={styles.lastStat}>{formatDuration(lastActivity.duration_seconds)}</Text>
              <Text style={styles.lastStat}>{formatDistance(lastActivity.distance_meters)}</Text>
              {lastActivity.avg_hr && (
                <Text style={[styles.lastStat, { color: colors.accent }]}>
                  ♥ {lastActivity.avg_hr} bpm
                </Text>
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  raceCard: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  raceLabel: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  raceCountdown: { color: colors.bg, fontWeight: '900', fontSize: 28 },

  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    width: '48%',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  statSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  polCard: {
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  polOk: { backgroundColor: '#052a10', borderColor: colors.Z2 },
  polWarn: { backgroundColor: '#2a1400', borderColor: colors.Z3 },
  polText: { color: colors.text, fontWeight: '600', fontSize: 14 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },

  zoneBar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    gap: 1,
  },
  zoneSeg: { height: '100%' },
  zoneLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  zoneLegendText: { fontSize: 12, fontWeight: '600' },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  emptyText: { color: colors.textMuted, fontSize: 14 },

  lastRow: { flexDirection: 'row', justifyContent: 'space-between' },
  lastDate: { color: colors.text, fontSize: 15, fontWeight: '700' },
  lastType: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  lastStats: { flexDirection: 'row', gap: 16 },
  lastStat: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
