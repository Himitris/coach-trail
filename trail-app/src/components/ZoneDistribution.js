import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, ZONE_LABELS } from '../theme';

export default function ZoneDistribution({ distribution }) {
  if (!distribution) return null;

  return (
    <View style={styles.container}>
      {Object.entries(distribution).map(([zone, data]) => (
        <View key={zone} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: colors[zone] }]} />
          <Text style={styles.zone}>{zone}</Text>
          <View style={styles.barBg}>
            <View
              style={[
                styles.barFill,
                { width: `${data.percent}%`, backgroundColor: colors[zone] },
              ]}
            />
          </View>
          <Text style={styles.percent}>{data.percent.toFixed(1)}%</Text>
          <Text style={styles.duration}>{formatSeconds(data.seconds)}</Text>
        </View>
      ))}
    </View>
  );
}

function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}min`;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  zone: {
    color: colors.text,
    fontWeight: '700',
    width: 28,
    fontSize: 13,
  },
  barBg: {
    flex: 1,
    height: 10,
    backgroundColor: '#2A2A2A',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  percent: {
    color: colors.text,
    width: 46,
    textAlign: 'right',
    fontSize: 13,
  },
  duration: {
    color: colors.textMuted,
    width: 46,
    textAlign: 'right',
    fontSize: 12,
  },
});
