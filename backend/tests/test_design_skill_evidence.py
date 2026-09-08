"""Guidance must never masquerade as a measured interface audit."""
import asyncio

import pytest

from app.plugin_system import PluginConfig
from app.plugins.ui_ux_pro_max_skill import UIUXProMaxSkill, metadata


def skill():
    instance = UIUXProMaxSkill(PluginConfig(), metadata)
    instance.available = True
    return instance


def test_review_requires_evidence_before_scoring():
    result = asyncio.run(skill().execute_skill("ui_ux_review", {
        "design_description": "Checkout with unreadable text and no keyboard support",
    }))
    assert result["overall_score"] is None
    assert result["scores"] == {}
    assert result["verified"] is False
    assert result["assessment_type"] == "guidance_only"
    assert result["evidence_required"]
    assert result["feedback"]


@pytest.mark.parametrize("name,field", [
    ("ui_ux_review", "design_description"),
    ("ui_ux_suggest_components", "feature_description"),
])
@pytest.mark.parametrize("value", [None, "", "  ", 42])
def test_missing_description_has_actionable_error(name, field, value):
    with pytest.raises(ValueError, match=field):
        asyncio.run(skill().execute_skill(name, {field: value}))
