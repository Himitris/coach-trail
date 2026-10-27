import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { colors } from '../theme';
import { api, loadBaseURL, saveBaseURL, getBaseURL } from '../api';

export default function SettingsScreen() {
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    loadBaseURL().then(u => setUrl(u));
  }, []);

  async function handleSave() {
    await saveBaseURL(url);
    Alert.alert('Sauvegardé', `URL mise à jour : ${url}`);
  }

  async function handleTest() {
    setTesting(true);
    setHealth(null);
    try {
      await saveBaseURL(url);
      const data = await api.health();
      setHealth(data);
    } catch (e) {
      Alert.alert('Erreur de connexion', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Serveur API</Text>

      <Text style={styles.label}>URL du serveur</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.204:8000"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="url"
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleSave}>
          <Text style={styles.btnSecondaryText}>Sauvegarder</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnPrimary} onPress={handleTest}>
          {testing
            ? <ActivityIndicator color={colors.bg} size="small" />
            : <Text style={styles.btnPrimaryText}>Tester la connexion</Text>
          }
        </TouchableOpacity>
      </View>

      {health && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>✓ Connecté</Text>
          <Row label="Activités" value={health.total_activities} />
          <Row label="Points FC" value={health.total_hr_points?.toLocaleString()} />
          <Row label="Dernière sync" value={health.last_sync?.slice(0, 19).replace('T', ' ')} />
        </View>
      )}

      <Text style={styles.sectionTitle}>À propos</Text>
      <View style={styles.card}>
        <Row label="FCmax" value="196 BPM" />
        <Row label="FC repos" value="50 BPM" />
        <Row label="Objectif" value="Trail 31km — 8 nov 2026" />
      </View>
    </ScrollView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  sectionTitle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  row: { flexDirection: 'row', gap: 10 },
  btnPrimary: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 10,
    padding: 13,
    alignItems: 'center',
  },
  btnPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  btnSecondary: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  btnSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  cardTitle: { color: colors.Z2, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { color: colors.textMuted, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
