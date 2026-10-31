import barcelona from "../../../../fixtures/plans/barcelona/plan.json";
import chatka from "../../../../fixtures/plans/chatka/plan.json";
import dinara from "../../../../fixtures/plans/dinara/plan.json";
import gruzja from "../../../../fixtures/plans/gruzja/plan.json";
import maroko from "../../../../fixtures/plans/maroko/plan.json";

/**
 * Przykładowe wyjazdy: pięć planów wzorcowych z `fixtures/plans/` (zanonimizowane, w publicznym
 * repo). Ładowane na konto zalogowanej osoby przyciskiem na liście wyjazdów — do pokazania
 * aplikacji i do testów na bazie w chmurze, gdzie nie ma seeda.
 */
export const SAMPLE_PLANS: unknown[] = [maroko, barcelona, gruzja, chatka, dinara];
