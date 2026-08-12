import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

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

    def test_rate_limiter_does_not_hold_global_lock_while_waiting(self):
        now = [1000.0]
        sleeping = threading.Event()
        release_sleep = threading.Event()

        def sleep(seconds):
            sleeping.set()
            release_sleep.wait(1)
            now[0] += seconds

        limiter = language_service.GeminiFreeTierRateLimiter(now_func=lambda: now[0], sleep_func=sleep)
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)
            waiting = threading.Thread(
                target=lambda: limiter.reserve(cache_dir, "gemini-3.5-flash", token_estimate=100)
            )
            waiting.start()
            self.assertTrue(sleeping.wait(1))
            other_completed = threading.Event()
            other = threading.Thread(
                target=lambda: (limiter.reserve(cache_dir, "gemini-3.1-flash-lite", 100), other_completed.set())
            )
            other.start()
            try:
                self.assertTrue(other_completed.wait(0.5))
            finally:
                release_sleep.set()
                waiting.join(1)
                other.join(1)

    def test_rate_limiter_rejects_wait_beyond_deadline_without_sleeping(self):
        now = [1000.0]
        sleeps = []
        limiter = language_service.GeminiFreeTierRateLimiter(
            now_func=lambda: now[0], sleep_func=sleeps.append
        )
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            limiter.reserve(cache_dir, "gemini-3.5-flash", 100)
            with self.assertRaises(TimeoutError):
                limiter.reserve(cache_dir, "gemini-3.5-flash", 100, deadline=1005.0)
        self.assertEqual(sleeps, [])

    def test_invalid_gemini_cache_is_quarantined_and_replaced_atomically(self):
        response = mock.Mock(text='{"items":[{"value":"fresh"}]}')
        client = mock.Mock()
        client.models.generate_content.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            fingerprint = language_service.build_request_fingerprint(
                "gemini-3.5-flash", "system", {"input": 1}, extra_config={"response_mime_type": "application/json"}
            )
            cache_path = cache_dir / f"{fingerprint}.json"
            cache_path.write_text('{"schemaVersion":1,"response":', encoding="utf-8")

            with mock.patch.object(language_service.genai, "Client", return_value=client), mock.patch.object(
                language_service._GEMINI_RATE_LIMITER, "reserve"
            ):
                result = language_service.request_gemini_with_cache(
                    cache_dir,
                    "gemini-3.5-flash",
                    "system",
                    {"input": 1},
                    extra_config={"api_key": "test", "response_mime_type": "application/json"},
                )

            self.assertEqual(result, response.text)
            self.assertTrue(list(cache_dir.glob(f"{fingerprint}.json.corrupt-*")))
            envelope = language_service.DurableJsonRepository().read(cache_path).value
            self.assertEqual(envelope["schemaVersion"], 1)
            self.assertEqual(envelope["fingerprint"], fingerprint)
            self.assertEqual(envelope["response"], response.text)

    def test_different_gemini_fingerprints_do_not_share_network_lock(self):
        first_started = threading.Event()
        release_first = threading.Event()
        second_finished = threading.Event()

        class Models:
            def generate_content(self, *, contents, **_kwargs):
                if "first" in contents:
                    first_started.set()
                    release_first.wait(1)
                else:
                    second_finished.set()
                return mock.Mock(text='{"ok":true}')

        client = mock.Mock(models=Models())
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(
            language_service.genai, "Client", return_value=client
        ), mock.patch.object(language_service._GEMINI_RATE_LIMITER, "reserve"):
            cache_dir = Path(tmp)
            first = threading.Thread(target=lambda: language_service.request_gemini_with_cache(
                cache_dir, "gemini-3.5-flash", "system", {"value": "first"},
                extra_config={"api_key": "test"},
            ))
            second = threading.Thread(target=lambda: language_service.request_gemini_with_cache(
                cache_dir, "gemini-3.5-flash", "system", {"value": "second"},
                extra_config={"api_key": "test"},
            ))
            first.start()
            self.assertTrue(first_started.wait(1))
            second.start()
            try:
                self.assertTrue(second_finished.wait(0.5))
            finally:
                release_first.set()
                first.join(1)
                second.join(1)


if __name__ == "__main__":
    unittest.main()
