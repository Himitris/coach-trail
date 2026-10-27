import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { colors } from '../../theme';
import { linearTrend, trendDirection } from '../../utils/stats';

const screenWidth = Dimensions.get('window').width;

const TREND_LABEL = {
  down: { text: '↓ FC en baisse — progression aérobie', color: colors.Z2 },
  up: { text: '↑ FC en hausse à effort constant', color: colors.Z4 },
  flat: { text: '→ FC stable', color: colors.textMuted },
};

// FC moyenne sur les sorties "running" de ~40-50 min, pour suivre la progression aérobie à effort constant
export default function HrEffortChart({ runs }) {
  if (!runs || runs.length < 2) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>FC moyenne à effort constant (40-50 min)</Text>
        <Text style={styles.empty}>Pas assez de séances comparables sur cette période.</Text>
      </View>
    );
  }

  const hr = runs.map(r => r.avg_hr);
  const trend = linearTrend(hr);
  const direction = trendDirection(hr);
  const info = TREND_LABEL[direction];

  const data = runs.map((r, i) => ({ value: hr[i], label: r.date.slice(5) }));
  const data2 = trend.map(v => ({ value: v }));

  const minValue = Math.floor(Math.min(...hr) - 5);
  const maxValue = Math.ceil(Math.max(...hr) + 5);
  const chartWidth = Math.max(screenWidth - 80, runs.length * 44);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>FC moyenne à effort constant (40-50 min)</Text>
      <LineChart
        data={data}
        data2={data2}
        width={chartWidth}
        height={170}
        color={colors.Z5}
        color2={colors.accent}
        thickness={2}
        thickness2={2}
        dataPointsColor={colors.Z5}
        dataPointsColor2="transparent"
        hideDataPoints2
        textColor={colors.textMuted}
        textFontSize={9}
        curved
        yAxisOffset={minValue}
        maxValue={maxValue - minValue}
        noOfSections={4}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 9 }}
        rulesColor={colors.cardBorder}
        xAxisColor={colors.cardBorder}
        yAxisColor={colors.cardBorder}
      />
      <View style={styles.legendRow}>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.Z5 }]} />
            <Text style={styles.legendText}>FC moyenne (bpm)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
            <Text style={styles.legendText}>Tendance</Text>
          </View>
        </View>
        <Text style={[styles.trendLabel, { color: info.color }]}>{info.text}</Text>
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
  empty: { color: colors.textMuted, fontSize: 13 },
  legendRow: { gap: 6 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.textMuted, fontSize: 11 },
  trendLabel: { fontSize: 12, fontWeight: '600' },
});
