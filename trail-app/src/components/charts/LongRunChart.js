import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { colors } from '../../theme';
import { longRunTargetMid } from '../../utils/stats';

const screenWidth = Dimensions.get('window').width;

// Progression de la durée des sorties longues, avec la cible mensuelle du plan superposée
export default function LongRunChart({ runs }) {
  if (!runs || runs.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Sorties longues — progression</Text>
        <Text style={styles.empty}>Pas encore assez de sorties longues sur cette période.</Text>
      </View>
    );
  }

  const hours = runs.map(r => r.duration_seconds / 3600);
  const targets = runs.map(r => {
    const t = longRunTargetMid(r.date);
    return t != null ? t / 3600 : null;
  });

  const data = runs.map((r, i) => ({
    value: hours[i],
    label: r.date.slice(5),
    dataPointText: hours[i].toFixed(1),
  }));

  const hasTargets = targets.some(t => t != null);
  const data2 = hasTargets
    ? runs.map((r, i) => ({ value: targets[i] ?? hours[i] }))
    : undefined;

  const maxValue = Math.ceil(Math.max(...hours, ...targets.filter(t => t != null), 1) + 0.5);
  const chartWidth = Math.max(screenWidth - 80, runs.length * 50);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Sorties longues — progression (h)</Text>
      <LineChart
        data={data}
        data2={data2}
        width={chartWidth}
        height={170}
        color={colors.accent}
        color2={colors.Z3}
        thickness={2}
        thickness2={2}
        dataPointsColor={colors.accent}
        dataPointsColor2="transparent"
        textColor={colors.textMuted}
        textFontSize={9}
        curved
        maxValue={maxValue}
        noOfSections={4}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 9 }}
        rulesColor={colors.cardBorder}
        xAxisColor={colors.cardBorder}
        yAxisColor={colors.cardBorder}
        dashWidth={data2 ? 6 : 0}
        dashGap={data2 ? 4 : 0}
      />
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>Durée réelle</Text>
        </View>
        {hasTargets && (
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.Z3 }]} />
            <Text style={styles.legendText}>Cible du plan (médiane)</Text>
          </View>
        )}
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
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.textMuted, fontSize: 11 },
});
