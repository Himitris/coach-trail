import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Polyline, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';
import { classifyHR, downsample } from '../utils/zones';

const WIDTH = Dimensions.get('window').width - 48;
const HEIGHT = 160;
const PADDING = { top: 10, bottom: 24, left: 32, right: 8 };

const ZONE_BANDS = [
  { zone: 'Z1', min: 50,  max: 138 },
  { zone: 'Z2', min: 138, max: 152 },
  { zone: 'Z3', min: 152, max: 174 },
  { zone: 'Z4', min: 174, max: 189 },
  { zone: 'Z5', min: 189, max: 200 },
];

const HR_MIN = 50;
const HR_MAX = 200;

function toX(offset, maxOffset) {
  const w = WIDTH - PADDING.left - PADDING.right;
  return PADDING.left + (offset / maxOffset) * w;
}

function toY(bpm) {
  const h = HEIGHT - PADDING.top - PADDING.bottom;
  return PADDING.top + h - ((bpm - HR_MIN) / (HR_MAX - HR_MIN)) * h;
}

export default function HRChart({ timeseries }) {
  const points = useMemo(() => downsample(timeseries, 300), [timeseries]);

  if (!points || points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Données FC non disponibles</Text>
      </View>
    );
  }

  const maxOffset = points[points.length - 1].offset;
  const polyline = points
    .map(p => `${toX(p.offset, maxOffset).toFixed(1)},${toY(p.bpm).toFixed(1)}`)
    .join(' ');

  const chartH = HEIGHT - PADDING.top - PADDING.bottom;
  const chartLeft = PADDING.left;
  const chartW = WIDTH - PADDING.left - PADDING.right;

  // Ticks axe temps (toutes les 10 min)
  const durationMin = Math.round(maxOffset / 60);
  const tickEvery = durationMin <= 30 ? 10 : durationMin <= 60 ? 15 : 30;
  const timeTicks = [];
  for (let t = 0; t <= durationMin; t += tickEvery) {
    timeTicks.push(t);
  }

  return (
    <Svg width={WIDTH} height={HEIGHT}>
      {/* Bandes de zones */}
      {ZONE_BANDS.map(({ zone, min, max }) => {
        const y1 = toY(max);
        const y2 = toY(min);
        return (
          <Rect
            key={zone}
            x={chartLeft}
            y={y1}
            width={chartW}
            height={y2 - y1}
            fill={colors[zone]}
            opacity={0.15}
          />
        );
      })}

      {/* Lignes de grille HR */}
      {[140, 160, 180].map(bpm => (
        <Line
          key={bpm}
          x1={chartLeft}
          y1={toY(bpm)}
          x2={chartLeft + chartW}
          y2={toY(bpm)}
          stroke="#333"
          strokeWidth={1}
        />
      ))}

      {/* Labels axe Y */}
      {[140, 160, 180].map(bpm => (
        <SvgText
          key={bpm}
          x={chartLeft - 4}
          y={toY(bpm) + 4}
          fill={colors.textMuted}
          fontSize={10}
          textAnchor="end"
        >
          {bpm}
        </SvgText>
      ))}

      {/* Ticks axe X */}
      {timeTicks.map(t => {
        const x = toX(t * 60, maxOffset);
        return (
          <SvgText
            key={t}
            x={x}
            y={HEIGHT - 4}
            fill={colors.textMuted}
            fontSize={10}
            textAnchor="middle"
          >
            {t}min
          </SvgText>
        );
      })}

      {/* Courbe FC */}
      <Polyline
        points={polyline}
        fill="none"
        stroke={colors.accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty: {
    height: HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
