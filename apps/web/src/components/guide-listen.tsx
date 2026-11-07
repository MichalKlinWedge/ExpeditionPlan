"use client";

import { type GuideContent, guideText, speechParts } from "@expeditionplan/core";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * „Posłuchaj” na webie: przewodnik czytany syntezatorem mowy przeglądarki (`speechSynthesis`), jak na
 * telefonie. Polski głos, jeśli przeglądarka go ma; bez syntezatora przycisku nie ma. Tekst idzie w
 * krótkich kawałkach, bo Chrome urywa długie wypowiedzi. Opuszczenie strony przerywa czytanie.
 */
const LIMIT = 1500;

function polishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang.toLowerCase() === "pl-pl") ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("pl"));
}

const noSubscribe = () => () => undefined;
const hasSpeech = () => "speechSynthesis" in window;
const onServer = () => false;

export function GuideListen({ guide, title }: { guide: GuideContent; title?: string }) {
  // Na serwerze i przy pierwszym renderze w przeglądarce bez przycisku — bez rozjazdu hydratacji.
  const supported = useSyncExternalStore(noSubscribe, hasSpeech, onServer);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    // Lista głosów w Chrome przychodzi asynchronicznie — pierwsze `getVoices()` bywa puste.
    const load = () => synth.getVoices();
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, [supported]);

  if (!supported) return null;

  const listen = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) return setSpeaking(false);
    const text = title ? `${title}.\n\n${guideText(guide)}` : guideText(guide);
    const parts = speechParts(text, LIMIT);
    const voice = polishVoice();
    const finished = () => setSpeaking(false);
    parts.forEach((part, i) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = "pl-PL";
      utterance.rate = 0.95;
      if (voice) utterance.voice = voice;
      // `cancel()` daje błąd „interrupted”/„canceled” — to zwykłe zatrzymanie, stan i tak wraca.
      utterance.onerror = finished;
      if (i === parts.length - 1) utterance.onend = finished;
      synth.speak(utterance);
    });
    setSpeaking(true);
  };

  return (
    <button type="button" onClick={listen} className="btn-mini shrink-0" aria-pressed={speaking}>
      {speaking ? "■ Zatrzymaj" : "▶ Posłuchaj"}
    </button>
  );
}
