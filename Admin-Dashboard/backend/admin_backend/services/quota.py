from typing import Any, Dict


_IMAGE_COST_USD = {"medium": 0.0551, "low": 0.0065}


def quota_payload(limits: Dict[str, int]) -> Dict[str, Any]:
    weekly = sum(_IMAGE_COST_USD[q] * limits.get(q, 0) for q in _IMAGE_COST_USD)
    return {
        "limits": limits,
        "costPerImageUsd": _IMAGE_COST_USD,
        "estimatedWeeklyUsdPerStudent": round(weekly, 4),
        "estimatedMonthlyUsdPerStudent": round(weekly * 4.3, 2),
    }
