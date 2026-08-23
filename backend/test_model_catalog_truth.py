import ast
from pathlib import Path
import unittest

from app.models_catalog import (
    MODELS_CATALOG,
    OMITTED_UNVERIFIED_MODEL_IDS,
    VERIFIED_OLLAMA_TAGS,
    _catalog_entry_for_model,
    assert_exact_hf_repository,
    get_full_catalog,
    mark_hf_repository_verified,
)


class ModelCatalogTruthTests(unittest.TestCase):
    @staticmethod
    def _main_function_source(function_name):
        main_path = Path(__file__).with_name("app") / "main.py"
        tree = ast.parse(main_path.read_text(encoding="utf-8"))
        function = next(
            node for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == function_name
        )
        return ast.unparse(function)

    def test_substituted_future_models_are_not_exposed(self):
        exposed_ids = {
            str(model.get("id") or "").strip().casefold()
            for model in MODELS_CATALOG
        }
        self.assertTrue(exposed_ids.isdisjoint(OMITTED_UNVERIFIED_MODEL_IDS))

    def test_official_gemma_4_repository_is_not_replaced_by_gemma_2(self):
        entry = next(
            model for model in MODELS_CATALOG
            if model["id"] == "google/gemma-4-12B"
        )
        self.assertEqual(entry["hf_repo"], "google/gemma-4-12B")
        self.assertEqual(entry.get("ollama_tag"), "")

    def test_qwen3_is_not_aliased_to_qwen2_5(self):
        entry = next(
            model for model in MODELS_CATALOG
            if model["id"] == "Qwen/Qwen3-4B-AWQ"
        )
        self.assertEqual(entry.get("ollama_tag"), "")
        self.assertIsNone(_catalog_entry_for_model("qwen2.5:3b"))

    def test_only_primary_checked_ollama_tags_are_exposed(self):
        self.assertEqual(
            VERIFIED_OLLAMA_TAGS,
            frozenset({"qwen2.5vl:3b", "qwen2.5vl:7b"}),
        )
        rows = get_full_catalog()
        self.assertTrue(all(
            not row.get("ollama_tag") or row["ollama_tag_verified"]
            for row in rows
        ))

    def test_uncited_benchmarks_are_not_returned_as_facts(self):
        rows = get_full_catalog()
        self.assertTrue(all(not row["benchmarks"] for row in rows))
        self.assertTrue(all(
            row["benchmark_status"] == "unavailable_without_cited_primary_source"
            for row in rows
        ))

    def test_exact_repository_mismatch_is_rejected(self):
        self.assertEqual(
            assert_exact_hf_repository(
                "google/gemma-4-12B",
                "GOOGLE/GEMMA-4-12b",
            ),
            "google/gemma-4-12B",
        )
        substitutions = (
            (
                "moonshotai/Kimi-K3",
                "moonshotai/Moonlight-16B-A3B-Instruct",
            ),
            (
                "deepseek-ai/DeepSeek-V4-Pro",
                "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
            ),
            (
                "google/Gemma-4-32B",
                "google/gemma-2-27b-it",
            ),
        )
        for expected, resolved in substitutions:
            with self.subTest(expected=expected, resolved=resolved):
                with self.assertRaises(ValueError):
                    assert_exact_hf_repository(expected, resolved)

    def test_live_validation_state_is_explicit(self):
        repo_id = "google/gemma-4-12B"
        before = next(
            model for model in get_full_catalog()
            if model["id"] == repo_id
        )
        self.assertFalse(before["identity_verified"])
        self.assertTrue(before["download_validation_required"])

        mark_hf_repository_verified(repo_id)
        after = next(
            model for model in get_full_catalog()
            if model["id"] == repo_id
        )
        self.assertTrue(after["identity_verified"])
        self.assertFalse(after["download_validation_required"])
        self.assertEqual(after["verification_status"], "verified_exact_repository")

    def test_download_paths_validate_before_starting_or_fetching(self):
        endpoint_source = self._main_function_source("download_model_endpoint")
        self.assertLess(
            endpoint_source.index("_validate_exact_hf_repository"),
            endpoint_source.index("thread.start()"),
        )

        worker_source = self._main_function_source("_run_bg_download")
        self.assertNotIn("HfApi", worker_source)
        self.assertNotIn("model_entry else model_id", worker_source)
        self.assertLess(
            worker_source.index("_validate_exact_hf_repository"),
            worker_source.index("snapshot_download("),
        )


if __name__ == "__main__":
    unittest.main()
