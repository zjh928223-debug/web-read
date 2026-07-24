/**
 * Mirrors ECDICT's stardict.py stripword behavior for ASCII dictionary keys:
 * lowercase and remove every non-letter/digit character.
 */
export function normalizeDictionaryQuery(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
