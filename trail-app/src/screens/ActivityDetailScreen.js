import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { colors, ZONE_LABELS } from '../theme';
import { api } from '../api';
import { formatDuration, formatDistance, formatPace } from '../utils/zones';
import ZoneDistribution from '../components/ZoneDistribution';
import HRChart from '../components/HRChart';

const TYPE_ICON = { running: '🏃', trail_running: '⛰️', cycling: '🚴' };

export default function ActivityDetailScreen({ route }) {
  const { id } = route.params;
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.activity(id)
      .then(setActivity)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!activity) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Activité introuvable</Text>
      </View>
    );
  }

  const icon = TYPE_ICON[activity.type] || '🏃';
  const timeseries = activity.hr_timeseries || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerIcon}>{icon}</Text>
        <View>
          <Text style={styles.headerDate}>{activity.date}</Text>
          <Text style={styles.headerType}>{activity.type.replace('_', ' ')}</Text>
        </View>
      </View>

      {/* Stats clés */}
      <View style={styles.statsGrid}>
        <StatBox label="Durée" value={formatDuration(activity.duration_seconds)} />
        <StatBox label="Distance" value={formatDistance(activity.distance_meters)} />
        <StatBox label="D+" value={activity.elevation_gain ? `${Math.round(activity.elevation_gain)}m` : '–'} />
        <StatBox label="Allure" value={formatPace(activity.avg_pace_seconds_per_km)} />
        <StatBox label="FC moy" value={activity.avg_hr ? `${activity.avg_hr} bpm` : '–'} accent />
        <StatBox label="FC max" value={activity.max_hr ? `${activity.max_hr} bpm` : '–'} />
        <StatBox label="Cadence" value={activity.avg_cadence ? `${activity.avg_cadence} spm` : '–'} />
        <StatBox label="Calories" value={activity.calories ? `${activity.calories} kcal` : '–'} />
      </View>

      {/* Graphique FC */}
      {timeseries.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fréquence cardiaque</Text>
          <HRChart timeseries={timeseries} />
          <View style={styles.legend}>
            {['Z1','Z2','Z3','Z4','Z5'].map(z => (
              <View key={z} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors[z] }]} />
                <Text style={styles.legendText}>{z}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Répartition zones */}
      {activity.zone_distribution && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Répartition zones</Text>
          <ZoneDistribution distribution={activity.zone_distribution} />
        </View>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value, accent }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  error: { color: colors.textMuted, fontSize: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 8,
  },
  headerIcon: { fontSize: 36 },
  headerDate: { color: colors.text, fontSize: 20, fontWeight: '700' },
  headerType: { color: colors.textMuted, fontSize: 13, marginTop: 2, textTransform: 'capitalize' },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statBox: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    width: '48%',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700' },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 12,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },

  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11 },
});
