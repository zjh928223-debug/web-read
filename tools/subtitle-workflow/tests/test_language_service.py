import tempfile
import unittest
from pathlib import Path

import language_service


class LanguageServiceRateLimitTests(unittest.TestCase):
    def test_free_tier_limits_match_current_google_ai_studio_table(self):
        self.assertEqual(language_service.get_gemini_free_tier_limits("gemini-3.5-flash")["rpm"], 5)
        self.assertEqual(language_service.get_gemini_free_tier_limits("gemini-3.5-flash")["rpd"], 20)
        self.assertEqual(language_service.get_gemini_free_tier_limits("gemini-2.5-flash-lite")["rpm"], 10)
        self.assertEqual(language_service.get_gemini_free_tier_limits("gemini-3.1-flash-lite")["rpm"], 15)
        self.assertEqual(language_service.get_gemini_free_tier_limits("gemini-3.1-flash-lite")["rpd"], 500)

    def test_rate_limiter_waits_between_requests_for_same_model(self):
        now = [1000.0]
        sleeps = []

        def sleep(seconds):
            sleeps.append(seconds)
            now[0] += seconds

        limiter = language_service.GeminiFreeTierRateLimiter(
            now_func=lambda: now[0],
            sleep_func=sleep,
        )
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)
            limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)

        self.assertEqual(len(sleeps), 1)
        self.assertGreaterEqual(sleeps[0], 12.0)

    def test_rate_limiter_blocks_local_daily_limit_before_request(self):
        now = [1000.0]
        limiter = language_service.GeminiFreeTierRateLimiter(
            now_func=lambda: now[0],
            sleep_func=lambda seconds: now.__setitem__(0, now[0] + seconds),
        )
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            for _index in range(20):
                limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)
                now[0] += 12.1

            with self.assertRaisesRegex(RuntimeError, "daily free-tier limit"):
                limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)


if __name__ == "__main__":
    unittest.main()
