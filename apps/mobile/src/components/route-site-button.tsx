import { routeLinkLabel, routeLinkSite } from '@expeditionplan/core';
import { Image, Linking, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** Favikony serwisów (te same co na webie, `apps/web/public/route-icons`), w paczce aplikacji: działają offline. */
const SITE_ICON = {
  mapy: require('@/assets/images/route-icons/mapy.png'),
  google: require('@/assets/images/route-icons/google-maps.png'),
} as const;

/**
 * Link do trasy w zewnętrznej mapie jako mały przycisk z ikoną serwisu (mapy.com, Google Maps, inaczej 🗺),
 * jak na webie; nazwa serwisu w etykiecie dostępności.
 */
export function RouteSiteButton({ url, label = routeLinkLabel(url) }: { url: string; label?: string }) {
  const theme = useTheme();
  const site = routeLinkSite(url);
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.button, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }, pressed && styles.pressed]}>
      {site === null ? <ThemedText type="smallBold">🗺</ThemedText> : <Image source={SITE_ICON[site]} style={styles.icon} accessibilityIgnoresInvertColors />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 32, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 8 },
  icon: { width: 18, height: 18 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
