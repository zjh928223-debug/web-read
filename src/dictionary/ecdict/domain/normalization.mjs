/**
 * Mirrors ECDICT's stardict.py stripword behavior:
 * lowercase and remove every non-letter/digit character.
 */
export function normalizeDictionaryQuery(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
