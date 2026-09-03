import sys
import unittest
from pathlib import Path


CHUNKER_DIR = Path(__file__).resolve().parents[1] / "chunker"
if str(CHUNKER_DIR) not in sys.path:
    sys.path.insert(0, str(CHUNKER_DIR))

from chunk_rules import repair_sentence_boundary_cuts


class SentenceBoundaryCutTests(unittest.TestCase):
    def test_forces_terminal_cut_and_removes_leaked_successor_cut(self):
        words = [
            {"word": "solves?"},
            {"word": "The"},
            {"word": "answer"},
            {"word": "is"},
        ]

        self.assertEqual(repair_sentence_boundary_cuts(words, [2]), [1])

    def test_keeps_adjacent_terminal_cuts_for_one_word_sentences(self):
        words = [
            {"word": "Really?"},
            {"word": "Yes."},
            {"word": "Next"},
        ]

        self.assertEqual(repair_sentence_boundary_cuts(words, []), [1, 2])

    def test_does_not_infer_sentence_boundary_from_abbreviation(self):
        words = [
            {"word": "Dr."},
            {"word": "Smith"},
            {"word": "arrived."},
            {"word": "Next"},
        ]

        self.assertEqual(repair_sentence_boundary_cuts(words, []), [3])

    def test_discards_invalid_and_boolean_cut_values(self):
        words = [{"word": "One"}, {"word": "two"}, {"word": "done."}]

        self.assertEqual(repair_sentence_boundary_cuts(words, [True, 0, 1, 3, 1.0]), [1])
