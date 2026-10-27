import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme';
import { api } from '../api';
import { formatDuration, formatDistance, formatPace } from '../utils/zones';

const FILTERS = ['all', 'running', 'trail_running', 'cycling'];
const FILTER_LABELS = {
  all: 'Tout',
  running: 'Course',
  trail_running: 'Trail',
  cycling: 'Vélo',
};
const TYPE_ICON = {
  running: '🏃',
  trail_running: '⛰️',
  cycling: '🚴',
};

export default function ActivitiesScreen({ navigation }) {
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  async function load(reset = false) {
    const offset = reset ? 0 : page * PAGE_SIZE;
    try {
      const data = await api.activities({ type: filter, limit: PAGE_SIZE, offset });
      const items = data.activities;
      if (reset) {
        setActivities(items);
        setPage(1);
      } else {
        setActivities(prev => [...prev, ...items]);
        setPage(p => p + 1);
      }
      setHasMore(offset + items.length < data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setPage(0);
      setHasMore(true);
      load(true);
    }, [filter])
  );

  function onRefresh() {
    setRefreshing(true);
    setPage(0);
    load(true);
  }

  function onEndReached() {
    if (hasMore && !loading) load();
  }

  function renderItem({ item }) {
    const icon = TYPE_ICON[item.type] || '🏃';
    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => navigation.navigate('ActivityDetail', { id: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.itemLeft}>
          <Text style={styles.icon}>{icon}</Text>
          <View>
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.meta}>
              {formatDistance(item.distance_meters)}
              {item.elevation_gain > 0 ? `  D+ ${Math.round(item.elevation_gain)}m` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.itemRight}>
          <Text style={styles.duration}>{formatDuration(item.duration_seconds)}</Text>
          <Text style={styles.stats}>
            {formatPace(item.avg_pace_seconds_per_km)}
            {item.avg_hr ? `  ♥ ${item.avg_hr}` : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filtres */}
      <View style={styles.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {FILTER_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && activities.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={activities}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={
            hasMore && !loading ? (
              <ActivityIndicator color={colors.textMuted} style={{ margin: 16 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filters: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.bg },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  separator: { height: 1, backgroundColor: colors.cardBorder, marginVertical: 4 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  itemRight: { alignItems: 'flex-end' },
  icon: { fontSize: 22 },
  date: { color: colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  duration: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  stats: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
