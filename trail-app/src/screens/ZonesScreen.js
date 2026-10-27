import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput } from 'react-native';
import { colors, ZONE_LABELS, ZONE_RANGES } from '../theme';
import { classifyHR } from '../utils/zones';

const ZONES_DATA = [
  { zone: 'Z1', range: '123–137', label: 'Récupération', target: '' },
  { zone: 'Z2', range: '138–152', label: 'Endurance fondamentale', target: '← CIBLE 80%' },
  { zone: 'Z3', range: '153–174', label: 'Zone grise', target: '⚠ Éviter' },
  { zone: 'Z4', range: '175–189', label: 'Seuil lactique', target: '' },
  { zone: 'Z5', range: '190–196', label: 'VO2max', target: '← CIBLE 20%' },
];

const SESSIONS_DATA = [
  { type: 'Sortie longue', detail: 'Z2 strict — 138 à 152 BPM' },
  { type: 'Fractionnés', detail: 'Montée à 190–196 sur dernières reps' },
  { type: 'Tempo / seuil', detail: '170–178 BPM — montée route' },
];

export default function ZonesScreen() {
  const [bpmInput, setBpmInput] = useState('');
  const bpm = parseInt(bpmInput, 10);
  const currentZone = !isNaN(bpm) && bpm > 0 ? classifyHR(bpm) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Tableau zones */}
      <Text style={styles.sectionTitle}>Zones Karvonen</Text>
      <Text style={styles.sub}>FCmax 196 · FC repos 50 · RFC 146</Text>

      {ZONES_DATA.map(({ zone, range, label, target }) => (
        <View key={zone} style={styles.zoneRow}>
          <View style={[styles.zoneBadge, { backgroundColor: colors[zone] }]}>
            <Text style={styles.zoneBadgeText}>{zone}</Text>
          </View>
          <View style={styles.zoneInfo}>
            <Text style={styles.zoneRange}>{range} BPM</Text>
            <Text style={styles.zoneLabel}>{label}</Text>
          </View>
          {target ? (
            <Text style={[styles.zoneTarget, { color: zone === 'Z3' ? colors.Z3 : colors.Z2 }]}>
              {target}
            </Text>
          ) : null}
        </View>
      ))}

      {/* Calculateur */}
      <Text style={styles.sectionTitle}>Calculateur</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={bpmInput}
          onChangeText={setBpmInput}
          placeholder="Saisir un BPM..."
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={3}
        />
        {currentZone && (
          <View style={[styles.resultBadge, { backgroundColor: colors[currentZone] + '22', borderColor: colors[currentZone] }]}>
            <Text style={[styles.resultZone, { color: colors[currentZone] }]}>{currentZone}</Text>
            <Text style={styles.resultLabel}>{ZONE_LABELS[currentZone]}</Text>
          </View>
        )}
      </View>

      {/* Objectifs par séance */}
      <Text style={styles.sectionTitle}>Objectifs par séance</Text>
      {SESSIONS_DATA.map(({ type, detail }) => (
        <View key={type} style={styles.sessionRow}>
          <Text style={styles.sessionType}>{type}</Text>
          <Text style={styles.sessionDetail}>{detail}</Text>
        </View>
      ))}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: -6 },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  zoneBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoneBadgeText: { color: '#000', fontWeight: '900', fontSize: 13 },
  zoneInfo: { flex: 1 },
  zoneRange: { color: colors.text, fontSize: 14, fontWeight: '700' },
  zoneLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  zoneTarget: { fontSize: 11, fontWeight: '600', textAlign: 'right', maxWidth: 80 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 12,
  },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 8,
    padding: 12,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  resultBadge: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 2,
  },
  resultZone: { fontSize: 28, fontWeight: '900' },
  resultLabel: { color: colors.text, fontSize: 14, marginTop: 4 },

  sessionRow: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 4,
  },
  sessionType: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sessionDetail: { color: colors.textMuted, fontSize: 13 },
});
