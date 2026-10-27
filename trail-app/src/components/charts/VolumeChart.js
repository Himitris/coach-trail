import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { colors } from '../../theme';
import { linearTrend } from '../../utils/stats';

const screenWidth = Dimensions.get('window').width;

// Affiche le volume (en heures) par période sous forme de barres + une courbe de tendance
export default function VolumeChart({ data, labelKey }) {
  if (!data || data.length === 0) return null;

  const hours = data.map(d => d.duration_seconds / 3600);
  const trend = linearTrend(hours);

  const barData = data.map((d, i) => ({
    value: hours[i],
    label: String(d[labelKey]).slice(5),
    frontColor: colors.accent,
  }));

  const lineData = trend.map(v => ({ value: v }));

  const chartWidth = Math.max(screenWidth - 80, barData.length * 36);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Volume hebdomadaire — heures</Text>
      <BarChart
        data={barData}
        width={chartWidth}
        height={160}
        barWidth={18}
        spacing={18}
        roundedTop
        frontColor={colors.accent}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 9 }}
        noOfSections={4}
        rulesColor={colors.cardBorder}
        xAxisColor={colors.cardBorder}
        yAxisColor={colors.cardBorder}
        showLine
        lineData={lineData}
        lineConfig={{
          color: colors.Z4,
          thickness: 2,
          curved: true,
          hideDataPoints: true,
        }}
      />
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>Volume</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.Z4 }]} />
          <Text style={styles.legendText}>Tendance</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.textMuted, fontSize: 11 },
});
