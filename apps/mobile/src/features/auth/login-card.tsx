import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { Button as AppButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

import { AUTH_REDIRECT } from './session';

/** Logowanie: Google w przeglądarce systemowej albo link z maila (wraca do aplikacji linkiem). */
export function LoginCard() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const validEmail = email.includes('@');

  const google = async () => {
    setBusy(true);
    setStatus('');
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
      });
      if (error) throw error;
      const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT);
      if (result.type !== 'success') return;
      const code = new URL(result.url).searchParams.get('code');
      if (code === null) throw new Error('Brak kodu logowania w odpowiedzi.');
      const exchange = await supabase.auth.exchangeCodeForSession(code);
      // Link powrotu trafia też do routera — wymiana mogła już się udać tam.
      if (exchange.error && (await supabase.auth.getSession()).data.session === null) throw exchange.error;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const magicLink = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: AUTH_REDIRECT } });
    setBusy(false);
    setStatus(error ? error.message : `Wysłałem link na ${email.trim()}. Otwórz go na tym telefonie.`);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="subtitle">Logowanie</ThemedText>
      <AppButton label="Zaloguj przez Google" onPress={google} disabled={busy} />
      <ThemedText type="small">albo link na e-mail</ThemedText>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="ty@example.com"
        placeholderTextColor="#888"
        style={styles.input}
      />
      <AppButton label="Wyślij link" onPress={magicLink} disabled={busy || !validEmail} variant="primary" />
      {status !== '' && <ThemedText type="small">{status}</ThemedText>}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  input: { borderWidth: 1.5, borderColor: '#CFC4AB', borderRadius: 10, padding: Spacing.two, color: '#5F6B7A', backgroundColor: '#FFFFFF' },
});
